import test from 'node:test'
import assert from 'node:assert/strict'
import { writerFixture } from './exit-writer.test.mjs'
test('partial fill followed by broker cancellation releases only unfilled reservation', async t => {
  const f = await writerFixture(t); const ticket = f.tickets.stage(f.intent('terminal-partial'), 'trader'); f.tickets.approve(ticket.id, ticket.reviewHash); await f.writer.submit(ticket.id, ticket.reviewHash)
  const facts = f.engine.getSnapshot().brokerFacts; facts.workingOrders = [{ orderId: '123', symbol: 'AAA', side: 'sell', quantity: 5, status: 'canceled', orderType: 'MARKET', parentOrderId: null, ocoGroupId: null }]; facts.recentFills = [{ fillId: 'fill', orderId: '123', symbol: 'AAA', side: 'sell', quantity: 2, price: 21, filledAt: new Date().toISOString() }]
  f.engine.updateSnapshot({ brokerFacts: facts }); f.writer.reconcileKnown(); await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(f.recovery.snapshot.attempts[0].state, 'canceled'); assert.equal(f.recovery.snapshot.attempts[0].filledQuantity, 2); assert.equal(f.writer.reserved('fixture', 'AAA'), 0); assert.equal(f.writes.length, 1)
})
