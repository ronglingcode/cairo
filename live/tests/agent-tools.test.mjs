import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Engine } from '../src/engine.ts';
import { bookmapEvents, mentionedSymbols, runTool, tradingSnapshot } from '../src/agent-tools.ts';

const date = '2025-12-04';
const now = Date.parse(date + 'T15:00:00Z');
const ns = value => String(BigInt(value) * 1_000_000n);
const envelope = { symbol: 'META', sourceInstanceId: 'fixture', mode: 'replay', epoch: 1, sequence: 1 };
const snapshot = (time, patterns, overrides) => ({ ...envelope, type: 'cairo_patterns', version: 2, eventTime: ns(time),
  readiness: 'ready', coverage: 'continuous', patterns, ...overrides });
const event = (id, time, fields) => ({ id, eventTime: ns(time), observedAt: ns(time), revision: 1, type: 'BID_REAPPEAR', price: 188.31, size: 12_000, ...fields });

test('replay tools return displayed depth and only evidence visible in the active epoch', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cairo-bookmap-tools-'));
  const capture = join(temp, 'patterns');
  await mkdir(capture);
  const recent = event('recent', now - 1000);
  const earlier = event('earlier', now - 900_000);
  await writeFile(join(capture, 'patterns-abc-0.jsonl'), [
    snapshot(now - 900_000, [earlier]),
    snapshot(now - 900_000, [event('wrong-epoch', now - 900_000)], { epoch: 2 }),
    snapshot(now + 1000, [event('future', now + 1000)]),
  ].map(value => JSON.stringify(value)).join('\n'));
  const engine = new Engine({ mode: 'replay', sessionDate: date, replayRunId: 'tools' }, { notes: {}, delivered: [] }, () => {});
  engine.connect();
  engine.accept({ ...envelope, type: 'cairo_chart', version: 1, attached: true });
  engine.accept(snapshot(now, [recent, event('unobserved', now - 1000, { observedAt: ns(now + 1000) })], {
    liquidity: { asOf: ns(now), threshold: 5000, bids: [{ price: 188.31, displayedSize: 7143 }], offers: [] },
  }));
  const result = await bookmapEvents(engine, { symbol: 'META', price: 188.31, side: 'bid', minutes: 30, limit: 10 }, capture, new AbortController().signal);
  assert.deepEqual(result.events.map(item => item.id), ['recent', 'earlier']);
  const depth = await runTool('get_bookmap_depth', { symbol: 'META', price: 188.31 }, {
    engine, backtest: temp, captures: capture, depth: async () => undefined, signal: new AbortController().signal,
  });
  assert.deepEqual(depth.bids, [{ price: 188.31, displayedSize: 7143 }]);
  engine.accept({ ...envelope, epoch: 2, type: 'cairo_replay_reset', version: 1, eventTime: ns(now - 5000) });
  engine.accept(snapshot(now + 1000, [event('queued-old-epoch', now + 1000)], { sequence: 2 }));
  assert.deepEqual((await bookmapEvents(engine, { symbol: 'META', minutes: 30, limit: 10 }, capture, new AbortController().signal)).events, []);
});

test('each stock snapshot includes plan, closed fills, Bookmap evidence and bars visible at the cursor', async () => {
  const engine = new Engine({ mode: 'replay', sessionDate: date, replayRunId: 'tools' }, { notes: {}, delivered: [] }, () => {});
  engine.connect();
  engine.setPlan({ hash: '1', path: 'fixture.md', markdown: '## META\nUse the META stop.\n### Management\nKeep the flush low.\n## AMD\nUse 190 as stop.',
    plan: { researchCutoff: new Date(now - 1).toISOString(), watchlist: [{ symbol: 'META', setups: [] }, { symbol: 'AMD', setups: [] }] } });
  engine.accept({ ...envelope, type: 'cairo_chart', version: 1, attached: true });
  engine.accept(snapshot(now + 1000, [event('bid', now)]));
  const fill = { ...envelope, type: 'cairo_replay_fill', version: 1, positionId: 'open',
    price: 188, quantity: 100, positionAveragePrice: 188 };
  engine.accept({ ...fill, eventTime: ns(now), executionId: 'entry', side: 'BUY', positionQuantity: 100, opening: true });
  engine.accept({ ...fill, sequence: 2, eventTime: ns(now + 500), executionId: 'exit', side: 'SELL', positionQuantity: 0, opening: false });
  engine.accept({ ...fill, symbol: 'AMD', eventTime: ns(now), executionId: 'amd-entry', side: 'BUY', positionQuantity: 100, opening: true });
  const chart = { sessionDate: date, source: 'Bookmap observed trades', asOf: now + 2_000,
    bars: [[now - 60_000, 185, 190, 184, 188, 50_000], [now, 188, 193, 188, 193, 100_000], [now + 60_000, 193, 193, 193, 193, 100]] };
  const evidence = await tradingSnapshot('META', { engine, backtest: '', captures: '', signal: new AbortController().signal,
    depth: async () => ({ asOf: now, threshold: 5000, bids: [{ price: 188.31, displayedSize: 7000 }], offers: [] }),
    minutes: async () => chart });
  assert.equal(evidence.position, null);
  assert.deepEqual(evidence.plan.watchlist.map(item => item.symbol), ['META']);
  assert.match(evidence.plan.notes, /Keep the flush low/);
  assert.doesNotMatch(evidence.plan.notes, /AMD|190/);
  assert.deepEqual(evidence.executions.records.map(row => row[1]), ['BUY', 'SELL']);
  assert.deepEqual(evidence.chart.bars, chart.bars.slice(0, 1));
  assert.equal(evidence.bookmap.events.events[0].id, 'bid');
  assert.equal(evidence.bookmap.depth.bids[0].displayedSize, 7000);
  assert.deepEqual(mentionedSymbols('What about $META? Also BRK.B.', ['META', 'BRK.B', 'AMD']), ['META', 'BRK.B']);
});
