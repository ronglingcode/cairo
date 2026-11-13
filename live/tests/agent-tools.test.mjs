import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Engine } from '../src/engine.ts';
import { bookmapEvents, runTool } from '../src/agent-tools.ts';

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
    engine, backtest: temp, captures: capture, depth: async () => { throw new Error('Replay must use its cached snapshot'); }, signal: new AbortController().signal,
  });
  assert.deepEqual(depth.bids, [{ price: 188.31, displayedSize: 7143 }]);
  engine.accept({ ...envelope, epoch: 2, type: 'cairo_replay_reset', version: 1, eventTime: ns(now - 5000) });
  engine.accept(snapshot(now + 1000, [event('queued-old-epoch', now + 1000)], { sequence: 2 }));
  assert.deepEqual((await bookmapEvents(engine, { symbol: 'META', minutes: 30, limit: 10 }, capture, new AbortController().signal)).events, []);
});
