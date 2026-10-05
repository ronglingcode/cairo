import test from 'node:test'
import assert from 'node:assert/strict'
import { writerFixture } from './exit-writer.test.mjs'
import { wire } from './bookmap-receiver.test.mjs'
import { BookmapReceiver } from '../src/engine/BookmapReceiver.mts'
import { EntryObserver } from '../src/engine/EntryObserver.mts'
import { PositionGuidance } from '../src/engine/PositionGuidance.mts'
import { ManagementMonitor } from '../src/engine/ManagementMonitor.mts'
import { ProtectionCoordinator } from '../src/engine/ProtectionCoordinator.mts'
import { RecoveryBootstrap } from '../src/engine/RecoveryBootstrap.mts'
import { CairoDomainTools } from '../src/copilot/CairoDomainTools.mts'
import { injectTradingContext } from '../src/copilot/TradingContext.mts'
import { attachmentRequest } from './fixtures/positions.mjs'
test('premarket -> observer -> external fill -> partial + new protection approval -> recovery; second style stays independent', async t => {
  const f = await writerFixture(t); const engine = f.engine; const original = engine.getSnapshot().brokerFacts; let facts = structuredClone(original); facts.positions = []
  engine.updateSnapshot({ brokerFacts: facts, positions: [], preparation: { markdown: 'AAA: wait for bid reappear above my reviewed key level. BBB: exit all on confirmed weakness.', date: '2026-10-05', symbol: null, revision: 'notes', savedAt: new Date().toISOString() } })
  const tools = new CairoDomainTools(engine, async () => true); const step = { sessionID: 'fake', system: [] }; await injectTradingContext(step, async () => tools.context()); assert.ok(step.system[0].text.includes('wait for bid reappear'))
  const receiver = new BookmapReceiver(engine); const observer = new EntryObserver(engine)
  const observedWire = changes => wire(Date.now(), { symbol: { source: 'AAA', canonical: 'AAA' }, ...changes })
  receiver.receive(observedWire({ kind: 'heartbeat' })); observer.activate({ symbol: 'AAA', pattern: 'BID_REAPPEAR', tradebookId: 'partial', expectedRevision: engine.getSnapshot().tradebooks[0].revision, reviewed: true, confirmedClauses: [] })
  receiver.receive(observedWire({ episodeId: 'entry', sequence: 2 })); observer.cycle(); assert.ok(engine.getSnapshot().observationAttempts[0].signal); assert.equal(f.writes.length, 0)
  facts = structuredClone(original); engine.updateSnapshot({ brokerFacts: facts, positions: facts.positions }); observer.cycle()
  const guidance = new PositionGuidance(engine); const monitor = new ManagementMonitor(engine, guidance); const protection = new ProtectionCoordinator(engine, f.recovery)
  const partial = guidance.attach(attachmentRequest(engine)); const whole = guidance.attach(attachmentRequest(engine, 1, 'whole'))
  engine.updateSnapshot({ copilot: { source: 'copilot', state: 'disconnected', updatedAt: null, detail: 'synthetic outage' } }); monitor.confirm(partial.id, partial.revision, 1, 'trigger', true)
  const recommendation = engine.getSnapshot().recommendations.find(item => item.attachmentId === partial.id); assert.equal(recommendation.quantity, 5)
  const ticket = f.tickets.stage({ ...f.intent('acceptance-partial'), recommendationId: recommendation.id }, 'trader'); assert.equal(f.writes.length, 0); f.tickets.approve(ticket.id, ticket.reviewHash); await f.writer.submit(ticket.id, ticket.reviewHash); assert.equal(f.writes.length, 1)
  facts.positions[0].quantity = 5; facts.recentFills = [{ fillId: 'partial-complete', orderId: '123', symbol: 'AAA', side: 'sell', quantity: 5, price: 21, filledAt: new Date().toISOString() }]; engine.updateSnapshot({ brokerFacts: facts, positions: facts.positions, brokerFactsRevision: 2 }); protection.cycle(); f.writer.reconcileKnown(); await new Promise(resolve => setTimeout(resolve, 30)); guidance.reconcile()
  assert.equal(engine.getSnapshot().attachments[0].baseline.quantity, 5); assert.equal(engine.getSnapshot().attachments[1].baseline.quantity, 10)
  facts.workingOrders = [{ orderId: '77', symbol: 'AAA', side: 'sell', quantity: 10, filledQuantity: 0, status: 'working', orderType: 'STOP', parentOrderId: null, ocoGroupId: null, positionEffect: 'CLOSING', instruction: 'SELL', session: 'NORMAL', duration: 'DAY', strategy: 'SINGLE', legCount: 1, stopPrice: 19.5, limitPrice: null }]; engine.updateSnapshot({ brokerFacts: facts }); protection.cycle(); const proposal = engine.getSnapshot().protectionReadback.find(item => item.symbol === 'AAA').proposal; assert.equal(proposal.quantity, 5); assert.equal(f.writes.length, 1)
  const stop = f.tickets.stage({ ...proposal, commandId: 'acceptance-protection' }, 'trader'); f.tickets.approve(stop.id, stop.reviewHash); await f.writer.submit(stop.id, stop.reviewHash); assert.equal(f.writes[1].method, 'PUT')
  monitor.confirm(whole.id, whole.revision, 2, 'trigger', true); assert.equal(engine.getSnapshot().recommendations.find(item => item.attachmentId === whole.id).quantity, 10)
  await f.recovery.updateAttempt(stop.id, { state: 'unknown', brokerOrderId: null }); await f.recovery.change(current => ({ ...current, attachments: engine.getSnapshot().attachments, rules: monitor.checkpointState() }))
  new RecoveryBootstrap(engine, f.recovery, monitor).cycle(); assert.equal(engine.getSnapshot().tickets.length, 0); assert.ok(engine.getSnapshot().attachments.every(item => item.state === 'paused')); assert.throws(() => guidance.reconfirm(partial.id, partial.revision, 2, 10, true), /uncertain/); assert.equal(f.writes.length, 2)
})
