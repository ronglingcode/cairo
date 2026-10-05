import test from "node:test"
import assert from "node:assert/strict"
import { writerFixture } from "./exit-writer.test.mjs"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"
import { ProtectionCoordinator } from "../src/engine/ProtectionCoordinator.mts"
import { attachmentRequest } from "./fixtures/positions.mjs"
test("actual matching partial fills update remaining mapping; outside fills pause it", async t => {
  const f = await writerFixture(t); const guidance = new PositionGuidance(f.engine); const monitor = new ManagementMonitor(f.engine, guidance)
  const books = f.engine.getSnapshot().tradebooks; books[0].interpretation.management.allocations = [{ id: "core", shares: 5, remainder: false }, { id: "runner", shares: 5, remainder: true }]; books[0].interpretation.management.rules[0].action.quantity.allocationId = "core"; f.engine.updateSnapshot({ tradebooks: books })
  const attachment = guidance.attach(attachmentRequest(f.engine)); monitor.confirm(attachment.id, attachment.revision, 1, "trigger", true)
  const recommendation = f.engine.getSnapshot().recommendations[0]
  const request = { ...f.intent("partial-001"), recommendationId: recommendation.id }; const ticket = f.tickets.stage(request, "trader"); f.tickets.approve(ticket.id, ticket.reviewHash); await f.writer.submit(ticket.id, ticket.reviewHash)
  const facts = f.engine.getSnapshot().brokerFacts; facts.positions[0].quantity = 7; facts.recentFills = [{ fillId: "partial", orderId: "123", symbol: "AAA", side: "sell", quantity: 3, price: 21, filledAt: new Date().toISOString() }]
  f.engine.updateSnapshot({ brokerFacts: facts, positions: facts.positions, brokerFactsRevision: 2 })
  const coordinator = new ProtectionCoordinator(f.engine, f.recovery); coordinator.cycle(); guidance.reconcile()
  assert.equal(f.engine.getSnapshot().attachments[0].state, "active"); assert.equal(f.engine.getSnapshot().attachments[0].baseline.quantity, 7)
  assert.deepEqual(f.engine.getSnapshot().attachments[0].remainingAllocations, { core: 2, runner: 5 })
  facts.positions[0].quantity = 6; facts.recentFills.push({ ...facts.recentFills[0], fillId: "outside", orderId: "external", quantity: 1 }); f.engine.updateSnapshot({ brokerFacts: facts }); coordinator.cycle(); guidance.reconcile()
  assert.equal(f.engine.getSnapshot().attachments[0].state, "paused")
})
test("excess standalone protection proposes only a separately reviewed replacement; OCO stays manual", async t => {
  const f = await writerFixture(t); const facts = f.engine.getSnapshot().brokerFacts; facts.positions[0].quantity = 5
  facts.workingOrders = [{ orderId: "77", symbol: "AAA", side: "sell", quantity: 10, filledQuantity: 0, status: "working", orderType: "STOP", parentOrderId: null, ocoGroupId: null, positionEffect: "CLOSING", instruction: "SELL", session: "NORMAL", duration: "DAY", strategy: "SINGLE", legCount: 1, stopPrice: 19.5, limitPrice: null }]
  f.engine.updateSnapshot({ brokerFacts: facts, positions: facts.positions }); const coordinator = new ProtectionCoordinator(f.engine, f.recovery); coordinator.cycle()
  assert.equal(f.engine.getSnapshot().protectionReadback[0].proposal.quantity, 5); assert.equal(f.engine.getSnapshot().tickets.length, 0); assert.equal(f.writes.length, 0)
  facts.workingOrders[0].ocoGroupId = "oco"; f.engine.updateSnapshot({ brokerFacts: facts }); coordinator.cycle(); assert.equal(f.engine.getSnapshot().protectionReadback[0].proposal, null)
})
