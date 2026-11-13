import assert from 'node:assert/strict';
import test from 'node:test';
import { Engine } from '../src/engine.ts';
import { formatExitPlan, positionSizing, validateExitPlan } from '../src/exit-plan.ts';

const fill = (timestamp, quantity, isBuy, orderId) => ({ executionId: String(timestamp), orderId, timestamp, quantity, isBuy, price: 148 });

test('allocations use the first order including its split fills, before adds and partials', () => {
  const sizing = positionSizing(90, [fill(1, 70, true, 'entry'), fill(2, 30, true, 'entry'), fill(3, 20, false, 'partial'), fill(4, 10, true, 'add')]);
  assert.deepEqual(sizing, { originalShares: 100, remaining: 90, taken: 20, added: 10 });
  const targets = [{ price: 150, hint: 'Premarket high', percent: 5 }, { price: 152, hint: 'Gap fill', percent: 15 }];
  const plan = validateExitPlan({ targets, notes: [] }, sizing, 90);
  assert.deepEqual(plan.targets.map(target => target.shares), [5, 15]);
  assert.match(formatExitPlan(plan), /1\. \$150 Premarket high \(5%, 5 shares\)/);
  assert.throws(() => validateExitPlan({ targets: [{ ...targets[0], percent: 100 }], notes: [] }, sizing, 90), /exceed/);
});

test('short sizing excludes the closing leg of a reversal and refuses incomplete history', () => {
  const reversal = fill(2, 150, false, 'reversal');
  const cover = fill(3, 10, true, 'cover');
  assert.deepEqual(positionSizing(-40, [fill(1, 100, true, 'old'), reversal, cover]),
    { originalShares: 50, remaining: 40, taken: 10, added: 0 });
  assert.equal(positionSizing(-40, [cover]).originalShares, null);
});

test('a reconciled partial and add each request review, duplicate account snapshots do not', () => {
  const now = Date.parse('2025-12-04T16:00:00Z');
  const reviews = [];
  const engine = new Engine({ mode: 'live' }, { notes: {}, delivered: [] }, () => {}, () => now, undefined, position => reviews.push(position.quantity));
  const account = (sequence, positionQuantity, executions, delivery = 'stream') => engine.accept({
    type: 'cairo_account', version: 1, mode: 'live', symbol: 'META', sourceInstanceId: 'fixture',
    epoch: 1, sequence, delivery, asOf: now, positionQuantity, positionAveragePrice: 148, workingStops: [], executions,
  });
  const opening = fill(now - 500, 100, true, 'entry');
  const partial = fill(now - 300, 20, false, 'partial');
  const add = fill(now - 100, 10, true, 'add');
  engine.connect();
  account(1, 100, [opening], 'snapshot');
  account(2, 80, [opening, partial]);
  account(3, 80, [opening, partial]);
  account(4, 90, [opening, partial, add]);
  account(5, 0, [opening, partial, add, fill(now, 90, false, 'exit')]);
  assert.deepEqual(reviews, [80, 90]);
  assert.deepEqual(engine.snapshot().positions, []);
});
