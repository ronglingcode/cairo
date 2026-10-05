import test from "node:test"
import assert from "node:assert/strict"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"
import { positionEngine, attachmentRequest } from "./fixtures/positions.mjs"
test("different styles emit once from scoped confirmations without AI or orders", () => {
  const engine = positionEngine(); const guidance = new PositionGuidance(engine); const monitor = new ManagementMonitor(engine, guidance)
  const a = guidance.attach(attachmentRequest(engine)); const b = guidance.attach(attachmentRequest(engine, 1, "whole"))
  monitor.cycle(); assert.equal(engine.getSnapshot().recommendations.length, 0)
  monitor.confirm(a.id, a.revision, 1, "trigger", true); monitor.confirm(b.id, b.revision, 1, "trigger", true)
  monitor.cycle(); monitor.cycle()
  assert.deepEqual(engine.getSnapshot().recommendations.map(value => value.quantity), [5, 10])
  assert.equal(engine.getSnapshot().tickets.length, 0)
  assert.throws(() => monitor.confirm(a.id, a.revision, 1, "invented", true), /not a human/)
  const facts = engine.getSnapshot().brokerFacts; facts.positions[0].quantity = 12; engine.updateSnapshot({ brokerFacts: facts, positions: facts.positions, brokerFactsRevision: 2 }); guidance.reconcile(); monitor.cycle()
  assert.equal(engine.getSnapshot().recommendations[0].state, "invalidated")
})
test("follow-ups await actual bound order fills, not order acceptance", () => {
  const engine = positionEngine(); const book = engine.getSnapshot().tradebooks[0]
  book.interpretation.clauses.push({ ...book.interpretation.clauses[0], clauseId: "follow" })
  book.interpretation.management.rules.push({ ...structuredClone(book.interpretation.management.rules[0]), id: "follow", clauseId: "follow", action: { kind: "close", quantity: { basis: "all" }, orderType: "market" }, dependencies: [{ ruleId: "exit", state: "filled" }] })
  engine.updateSnapshot({ tradebooks: [book] }); const guidance = new PositionGuidance(engine); const monitor = new ManagementMonitor(engine, guidance)
  const attachment = guidance.attach(attachmentRequest(engine)); monitor.confirm(attachment.id, attachment.revision, 1, "trigger", true)
  assert.equal(engine.getSnapshot().recommendations.length, 1)
  monitor.bindSubmittedOrder(engine.getSnapshot().recommendations[0].id, "broker-exit"); monitor.cycle()
  assert.equal(engine.getSnapshot().recommendations.length, 1)
  const facts = engine.getSnapshot().brokerFacts; facts.recentFills = [{ fillId: "fill", orderId: "broker-exit", symbol: "AAA", side: "sell", quantity: 5, price: 21, filledAt: new Date().toISOString() }]
  engine.updateSnapshot({ brokerFacts: facts }); monitor.cycle()
  assert.equal(engine.getSnapshot().recommendations.length, 2)
  assert.throws(() => monitor.rearm(attachment.id, attachment.revision, "exit"), /Completed/)
})
