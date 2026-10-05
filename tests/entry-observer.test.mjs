import test from 'node:test'
import assert from 'node:assert/strict'
import { CairoEngine } from '../src/engine/CairoEngine.mts'
import { BookmapReceiver } from '../src/engine/BookmapReceiver.mts'
import { EntryObserver } from '../src/engine/EntryObserver.mts'
import { wire } from './bookmap-receiver.test.mjs'
test('one observer recommendation, updates amend, bootstrap/reset/gates cannot place entry', () => {
  let now = Date.now(); const engine = new CairoEngine(); const receiver = new BookmapReceiver(engine, () => now); const observer = new EntryObserver(engine, () => now)
  const source = { source: 'broker', state: 'connected', updatedAt: new Date(now).toISOString(), detail: null }
  const book = { id: 'book', title: 'Personal', markdown: 'Above my key level', contentHash: 'h', revision: 'r', interpretation: { tradebookId: 'book', narrativeHash: 'h', clauses: [{ clauseId: 'key', sourceText: 'Above my key level', coverage: 'human', mandatory: true, explanation: 'Confirm' }] } }
  engine.updateSnapshot({ broker: source, brokerFacts: { accountId: 'a', asOf: source.updatedAt, source, ordersComplete: true, positions: [], workingOrders: [], recentFills: [] }, tradebooks: [book] }); receiver.receive(wire(now, { kind: 'heartbeat' }))
  const input = { symbol: 'AAPL', pattern: 'BID_REAPPEAR', tradebookId: 'book', expectedRevision: 'r', reviewed: true, confirmedClauses: ['key'] }
  assert.throws(() => observer.activate({ ...input, confirmedClauses: [] })); observer.activate(input)
  receiver.receive(wire(now, { delivery: 'snapshot' })); observer.cycle(); assert.equal(engine.getSnapshot().observationAttempts[0].signal, null)
  now++; receiver.receive(wire(now, { episodeId: 'fresh', sequence: 2 })); observer.cycle(); const signal = engine.getSnapshot().observationAttempts[0].signal; assert.ok(signal)
  receiver.receive(wire(now, { episodeId: 'fresh', sequence: 3, revision: 2 })); observer.cycle(); assert.equal(engine.getSnapshot().observationAttempts[0].signal.id, signal.id)
  receiver.receive(wire(now, { episodeId: 'another', sequence: 4 })); observer.cycle(); assert.equal(engine.getSnapshot().observationAttempts[0].signal.evidence.episodeId, 'fresh')
  assert.equal(engine.getSnapshot().tickets.length, 0); assert.equal(engine.getSnapshot().brokerAttempts.length, 0)
  receiver.receive(wire(now, { kind: 'reset' })); observer.cycle(); assert.equal(engine.getSnapshot().observationAttempts[0].state, 'inactive')
  receiver.receive(wire(now, { kind: 'heartbeat', mode: 'unknown' })); observer.activate(input); receiver.receive(wire(now, { episodeId: 'unknown', sequence: 5, mode: 'unknown' })); observer.cycle(); assert.equal(engine.getSnapshot().observationAttempts.at(-1).signal, null)
  now += 300001; observer.cycle(); assert.equal(engine.getSnapshot().observationAttempts.at(-1).state, 'expired')
})
