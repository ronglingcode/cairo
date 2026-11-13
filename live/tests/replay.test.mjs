import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/engine.ts';
import { loadPlan, parsePlan, planPath, publishPlan } from '../src/plan.ts';
import { spokenPrice } from '../src/spoken-price.ts';

const date = '2025-12-04';
const replay = { mode: 'replay', sessionDate: date, replayRunId: 'sample' };
const cutoff = `${date}T09:30:00-05:00`;
const market = Date.parse(cutoff);
const rule = { id: 'test-level', predicate: 'crosses_above', priceBasis: 'bookmap_last', level: 101, label: 'Synthetic replay level' };
const manifest = { schemaVersion: 1, ...replay, revision: 1, researchCutoff: cutoff, confirmedAt: cutoff, researchPath: 'synthetic', tradebookRevision: 'fixture',
  watchlist: [{ symbol: 'META', setups: [{ direction: 'long', tradebook: 'Key Level Decision', tradebookPath: 'tradebooks/daily-chart/key-level-decision.md', patterns: ['Bid Lift'], decisionLevels: [], conditions: [rule] }] }] };
const markdown = plan => `# Synthetic test plan\n\n\`\`\`cairo-plan\n${JSON.stringify(plan)}\n\`\`\`\n`;
const wire = (type, fields) => ({ type, version: 1, mode: 'replay', symbol: 'META', sourceInstanceId: 'fixture', epoch: 1, ...fields });
const stamp = offset => String(BigInt(market + offset) * 1_000_000n);
const fill = (sequence = 1, fields = {}) => wire('cairo_replay_fill', { sequence, eventTime: stamp(10), executionId: 'fill', positionId: 'open', side: 'BUY', price: 100, quantity: 5, positionQuantity: 5, positionAveragePrice: 100, opening: true, ...fields });
const trade = (sequence, price) => wire('cairo_trade', { sequence, tradeSequence: sequence, eventTime: stamp(sequence * 100), price });

test('normalizes clear spoken prices without guessing ambiguous shorthand', () => {
  assert.equal(spokenPrice('ninety-eight'), 98);
  assert.equal(spokenPrice('one hundred eighty-six point four two.'), 186.42);
  assert.equal(spokenPrice('one eighty six'), undefined);
});

test('publishes a replay plan only to its run folder and rejects revision races', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'cairo-plan-test-'));
  const rules = join(repo, 'tradebooks');
  await mkdir(join(rules, 'bookmap'), { recursive: true });
  await writeFile(join(rules, 'master_tradebooks.md'), '### [Key Level Decision: example](daily-chart/key-level-decision.md)\n');
  await writeFile(join(rules, 'bookmap', 'long.md'), '## Bid Lift\n');
  await writeFile(join(rules, 'bookmap', 'short.md'), '## Bid Breakdown\n');
  const target = await publishPlan(repo, markdown(manifest), 0);
  assert.equal(target, planPath(repo, replay));
  assert.equal((await loadPlan(repo, replay)).plan.revision, 1);
  await assert.rejects(publishPlan(repo, markdown(manifest), 0), /revision changed/);
  await assert.rejects(loadPlan(repo, { mode: 'live' }, date), /ENOENT/);
  assert.throws(() => parsePlan(markdown({ ...manifest, researchCutoff: `${date}T09:31:00-05:00` })), /cutoff/);
});

test('opens one simulated position, waits for confirmation, alerts once, and resets on rewind', () => {
  const alerts = [];
  const engine = new Engine(replay, { notes: {}, delivered: [] }, item => alerts.push(item));
  engine.setShadow(false);
  engine.setPlan({ plan: manifest, hash: 'approved', path: 'fixture', markdown: markdown(manifest) });
  engine.connect();
  engine.accept(wire('cairo_chart', { sequence: 1, attached: true }));
  engine.accept(fill()); engine.accept(fill());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'fill');
  assert.equal(alerts[0].spoken, true);
  const { id } = engine.snapshot().positions[0];
  engine.identify(id, 'Bid Lift', 98);
  const context = engine.context('META');
  assert.equal(engine.propose(id, context.serial, 'approved', { summary: 'Synthetic test', condition: rule }), true);
  engine.accept(trade(1, 100)); engine.accept(trade(2, 101));
  assert.equal(alerts.filter(item => item.kind === 'condition').length, 0);
  engine.approve(id);
  engine.accept(trade(3, 100)); engine.accept(trade(5, 102));
  assert.equal(alerts.filter(item => item.kind === 'condition').length, 0);
  engine.accept(trade(6, 100)); engine.accept(trade(7, 102));
  engine.accept(trade(8, 100)); engine.accept(trade(9, 102));
  assert.equal(alerts.filter(item => item.kind === 'condition').length, 1);
  engine.accept(wire('cairo_replay_reset', { epoch: 2, sequence: 1, eventTime: stamp(0) }));
  engine.accept(fill(2));
  assert.deepEqual(engine.snapshot().positions, []);
  assert.equal(engine.propose(id, context.serial, 'approved', { summary: 'Late', condition: rule }), false);
});

test('reviews a fresh pattern for a held position outside the watchlist', () => {
  const reviews = [];
  const alerts = [];
  const engine = new Engine(replay, { notes: {}, delivered: [] }, item => alerts.push(item), Date.now,
    (position, time) => reviews.push({ id: position.id, time }));
  const evidence = (sequence, offset, patterns, coverage = 'continuous') => wire('cairo_patterns', {
    version: 2, sequence, eventTime: stamp(offset), readiness: 'ready', coverage, patterns,
  });
  const pattern = (id, offset) => ({ id, type: 'BID_STEP_UP', revision: 1, eventTime: stamp(offset) });
  engine.connect();
  engine.accept(fill());
  const { id } = engine.snapshot().positions[0];
  engine.identify(id, 'Bid Lift', 98);
  engine.accept(evidence(1, 20, [pattern('baseline', 20)]));
  engine.accept(evidence(2, 30, [pattern('baseline', 20), pattern('fresh', 30)]));
  engine.accept(evidence(3, 40, [pattern('fresh', 30)]));
  engine.accept(evidence(4, 50, [pattern('gap', 50)], 'gap'));
  assert.deepEqual(reviews, [{ id, time: market + 30 }]);
  assert.equal(alerts.filter(item => item.kind === 'pattern').length, 0);
});

test('replay sells refresh management, preserve the original size, and clear the closed position', () => {
  const reviews = [];
  const engine = new Engine(replay, { notes: {}, delivered: [] }, () => {}, Date.now, undefined, position => reviews.push(position.quantity));
  engine.connect();
  engine.accept(fill(1, { quantity: 100, positionQuantity: 100, delivery: 'snapshot' }));
  const context = engine.context('META');
  const plan = { originalShares: 100, remaining: 100, targets: [], notes: ['Watch the retest low'] };
  assert.equal(engine.setExitPlan(context.position.id, context.serial, context.planHash, plan), true);
  engine.accept(fill(2, { side: 'SELL', executionId: 'partial', quantity: 20, positionQuantity: 80, opening: false }));
  assert.deepEqual(reviews, [80]);
  assert.deepEqual(engine.snapshot().positions[0].exitPlan, plan);
  assert.equal(engine.snapshot().positions[0].exitPlanNeedsReview, true);
  assert.equal(engine.sizing(engine.snapshot().positions[0]).originalShares, 100);
  engine.accept(fill(3, { side: 'SELL', executionId: 'close', quantity: 80, positionQuantity: 0, opening: false }));
  assert.deepEqual(engine.snapshot().positions, []);
  assert.equal(engine.recentFills('META')[0].records.at(-1).isBuy, false);
});

test('restores replay notes from a reconnect snapshot and does not ask again', () => {
  const alerts = [];
  const engine = new Engine(replay, { notes: {}, delivered: [] }, item => alerts.push(item));
  engine.connect(); engine.accept(fill());
  const id = engine.snapshot().positions[0].id;
  engine.identify(id, 'Bid Lift', 98);
  engine.disconnect(); engine.connect();
  engine.accept(fill(3, { opening: false, delivery: 'snapshot', executionId: 'add', positionQuantity: 10 }));
  assert.equal(engine.snapshot().positions[0].id, id);
  assert.equal(engine.snapshot().positions[0].note.intendedStop, 98);
  assert.equal(alerts.filter(item => item.kind === 'fill').length, 1);
});

test('does not expose an opening plan to a replay cursor before its evidence cutoff', () => {
  const alerts = [];
  const engine = new Engine(replay, { notes: {}, delivered: [] }, item => alerts.push(item));
  engine.setPlan({ plan: manifest, hash: 'approved', path: 'fixture', markdown: markdown(manifest) });
  engine.connect();
  engine.accept(wire('cairo_chart', { sequence: 1, attached: true }));
  engine.accept({ ...trade(1, 100), eventTime: stamp(-5000) });
  engine.accept({ ...trade(2, 102), eventTime: stamp(-1000) });
  assert.equal(engine.context('META').watch, undefined);
  assert.equal(alerts.length, 0);
  engine.accept(trade(3, 100)); engine.accept(trade(4, 102));
  assert.equal(alerts[0].kind, 'condition');
});

test('reconciles live flat-to-open, adds, stops, and reversal without replay input', () => {
  const now = market + 2000;
  const alerts = [];
  const engine = new Engine({ mode: 'live' }, { notes: {}, delivered: [] }, item => alerts.push(item), () => now);
  const account = (sequence, quantity, executions) => engine.accept(wire('cairo_account', { mode: 'live', sequence, asOf: now, positionQuantity: quantity,
    positionAveragePrice: quantity ? 100 : undefined, workingStops: quantity ? [{ price: 97, quantity: Math.abs(quantity) }] : [], executions }));
  const buy = { executionId: 'live-buy', timestamp: now, isBuy: true, positionEffectIsOpen: true, quantity: 5, price: 100 };
  engine.connect(); engine.accept(fill()); account(1, 0, []); account(2, 5, [buy]);
  const id = engine.snapshot().positions[0].id;
  assert.deepEqual(engine.snapshot().positions[0].brokerStops, [97]);
  account(3, 10, [buy, { ...buy, executionId: 'add' }]);
  assert.equal(engine.snapshot().positions[0].id, id);
  account(4, -5, [buy, { ...buy, executionId: 'live-short', isBuy: false }]);
  assert.notEqual(engine.snapshot().positions[0].id, id);
  assert.equal(alerts.filter(item => item.kind === 'fill').length, 2);
  assert.ok(alerts.every(item => !item.spoken));
});
