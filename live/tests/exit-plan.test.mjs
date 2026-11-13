import assert from 'node:assert/strict';
import test from 'node:test';
import { Engine } from '../src/engine.ts';
import { formatExitPlan, positionSizing, validateExitPlan } from '../src/exit-plan.ts';
import { activeTradeContext } from '../src/agent-tools.ts';

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

test('active trade context includes trader notes and excludes a previously closed trade', () => {
  const now = Date.parse('2025-12-04T16:00:00Z');
  const engine = new Engine({ mode: 'live' }, { notes: {}, delivered: [] }, () => {}, () => now);
  const records = [fill(now - 900, 20, true, 'old-entry'), fill(now - 800, 20, false, 'old-close'),
    fill(now - 700, 100, true, 'entry'), fill(now - 500, 20, false, 'partial'), fill(now - 200, 10, true, 'add')];
  engine.connect();
  engine.accept({ type: 'cairo_account', version: 1, mode: 'live', symbol: 'META', sourceInstanceId: 'fixture',
    epoch: 1, sequence: 1, delivery: 'snapshot', asOf: now, positionQuantity: 90, positionAveragePrice: 148,
    workingStops: [{ price: 146, quantity: 90 }], executions: records });
  const position = engine.identify(engine.snapshot().positions[0].id, 'Bid Lift', 147);
  const context = activeTradeContext(engine, position);
  assert.deepEqual(context.fills.map(({ action, quantity }) => [action, quantity]), [['entry', 100], ['partial', 20], ['add', 10]]);
  assert.equal(context.traderConfirmedPattern, 'Bid Lift');
  assert.equal(context.traderIntendedStop, 147);
  assert.deepEqual(context.brokerWorkingStops, [146]);
});

test('credits a better-price partial to the previous VWAP target and rejects a repeat after reconnect', () => {
  const now = Date.parse('2025-12-04T16:00:00Z');
  const init = { mode: 'live' };
  const engine = new Engine(init, { notes: {}, delivered: [] }, () => {}, () => now);
  const entry = { ...fill(now - 900, 500, true, 'entry'), positionEffectIsOpen: true };
  const partial = { ...fill(now - 500, 125, false, 'partial'), price: 152.06 };
  function account(target, sequence, quantity, executions, delivery) {
    target.accept({ type: 'cairo_account', version: 1, mode: 'live', symbol: 'META', sourceInstanceId: 'fixture',
      epoch: 1, sequence, delivery, asOf: now, positionQuantity: quantity, positionAveragePrice: 150.46, workingStops: [], executions });
  }
  engine.connect();
  account(engine, 1, 500, [entry], 'snapshot');
  const context = engine.context('META');
  const target = { price: 151.38, hint: 'VWAP — partial into VWAP', percent: 25, shares: 125 };
  assert.equal(engine.setExitPlan(context.position.id, context.serial, context.planHash,
    { originalShares: 500, remaining: 500, targets: [target], notes: [] }), true);
  account(engine, 2, 375, [entry, partial], 'stream');
  const reboot = new Engine(init, engine.saved(), () => {}, () => now);
  reboot.connect();
  account(reboot, 1, 375, [entry, partial], 'snapshot');
  const position = reboot.context('META').position;
  const [progress] = activeTradeContext(reboot, position).priorTargetFillProgress;
  assert.equal(progress.creditedShares, 125);
  assert.equal(progress.complete, true);
  assert.throws(() => reboot.checkExitPlan(position, { originalShares: 500, remaining: 375,
    targets: [{ price: 151.62, hint: 'Partial into the VWAP', percent: 20, shares: 100 }], notes: [] }), /Exit already credited/);
});

for (const side of ['long', 'short']) {
  test(`credits ${side} exit fills near the target and prevents repeating its allocation`, () => {
    const now = Date.parse('2025-12-04T16:00:00Z');
    const isLong = side === 'long';
    const direction = isLong ? 1 : -1;
    const engine = new Engine({ mode: 'live' }, { notes: {}, delivered: [] }, () => {}, () => now);
    engine.connect();
    const executions = [{ ...fill(now - 100, 300, isLong, 'entry'), positionEffectIsOpen: true }];
    function account(sequence, remaining) {
      engine.accept({ type: 'cairo_account', version: 1, mode: 'live', symbol: 'META', sourceInstanceId: 'fixture',
        epoch: 1, sequence, delivery: 'snapshot', asOf: now, positionQuantity: remaining * direction, positionAveragePrice: 158,
        workingStops: [], executions });
    }
    const target = { price: 160, hint: 'First target', shares: 100, percent: 100 / 3 };
    const nextTarget = { ...target, price: isLong ? 164 : 156, hint: 'Second target' };
    const plan = (remaining, targets) => ({ originalShares: 300, remaining, targets, notes: [] });
    function setPlan(remaining, targets) {
      const { position, serial, planHash } = engine.context('META');
      return engine.setExitPlan(position.id, serial, planHash, plan(remaining, targets));
    }
    account(1, 300);
    assert.equal(setPlan(300, [target, nextTarget]), true);
    executions.push({ ...fill(now - 80, 20, !isLong, 'outside'), price: 160 - direction * 1.01 });
    account(2, 280);
    assert.deepEqual(engine.exitProgress(engine.context('META').position), []);
    executions.push({ ...fill(now - 50, 60, !isLong, 'near'), price: 160 - direction * 0.99 });
    account(3, 220);
    assert.deepEqual(engine.context('META').position.exitPlan.targets.map(item => item.shares), [40, 100]);
    const moved = { ...target, price: 160 + direction * 0.10, shares: 40 };
    assert.equal(setPlan(220, [moved, nextTarget]), true);
    executions.push({ ...fill(now - 20, 40, !isLong, 'near-again'), price: moved.price - direction * 0.85 });
    account(4, 180);
    const position = engine.context('META').position;
    assert.deepEqual(engine.exitProgress(position).map(item => item.filled), [100]);
    assert.deepEqual(position.exitPlan.targets, [nextTarget]);
    assert.throws(() => setPlan(180, [target]), /Exit already credited/);
    assert.throws(() => setPlan(180, [{ ...target, price: 160 - direction * 0.5 }]), /Exit already credited/);
    assert.equal(setPlan(180, [nextTarget]), true);
  });
}
