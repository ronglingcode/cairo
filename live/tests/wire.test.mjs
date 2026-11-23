import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookmapEvents } from '../src/wire.ts';
test('lossless batches retain more than the former buffer cap and exact transition order', () => {
  const events = [{ type: 'cairo_chart', attached: true }, ...Array.from({ length: 40000 }, (_, i) => ({ type: 'cairo_trade', tradeSequence: i + 1, eventTime: String(i) })), { type: 'cairo_replay_reset' }];
  assert.deepEqual(bookmapEvents({ type: 'cairo_batch', version: 1, events }), events);
  assert.deepEqual(bookmapEvents(events[0]), [events[0]]);
});
test('malformed and nested batches are rejected before processing any event', () => {
  for (const wire of [{ type: 'cairo_batch', version: 2, events: [] }, { type: 'cairo_batch', version: 1, events: [{ type: 'cairo_trade' }, null] }, { type: 'cairo_batch', version: 1, events: [{ type: 'cairo_batch' }] }]) assert.throws(() => bookmapEvents(wire));
});
