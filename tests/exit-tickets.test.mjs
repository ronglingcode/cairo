import test from "node:test"
import assert from "node:assert/strict"
import { ExitTickets } from "../src/engine/ExitTickets.mts"
import { positionEngine, attachmentRequest } from "./fixtures/positions.mjs"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"
const input = () => ({ intent: "close", accountId: "fixture", positionId: "position-0", symbol: "AAA", positionSide: "long", factsRevision: 1, quantity: 5, orderType: "market", reason: "Reviewed manual close", commandId: "request-001" })
test("exact drafts deduplicate without writes, survive unchanged polling and invalidate on material changes", () => {
  const engine = positionEngine(); const tickets = new ExitTickets(engine)
  const ticket = tickets.stage(input(), "trader"); assert.equal(tickets.stage(input(), "trader").id, ticket.id)
  assert.equal(ticket.exactPayload.orderLegCollection[0].quantity, 5)
  assert.throws(() => tickets.stage({ ...input(), quantity: 6 }, "trader"), /different details/)
  const facts = engine.getSnapshot().brokerFacts; facts.asOf = new Date().toISOString(); facts.positions[0].markPrice = 22
  engine.updateSnapshot({ brokerFacts: facts, brokerFactsRevision: 2, brokerRefreshSequence: 10 }); tickets.cycle()
  assert.equal(engine.getSnapshot().tickets[0].state, "staged")
  facts.positions[0].quantity = 9; engine.updateSnapshot({ brokerFacts: facts, brokerFactsRevision: 3 }); tickets.cycle()
  assert.equal(engine.getSnapshot().tickets[0].state, "invalidated")
  assert.throws(() => tickets.stage(input(), "trader"), /no longer current/)
})
test("rule updates reuse one proposal; stale evidence, expiry and dismissal never authorize", () => {
  let now = Date.now(); const engine = positionEngine(); const guidance = new PositionGuidance(engine); const monitor = new ManagementMonitor(engine, guidance)
  const attachment = guidance.attach(attachmentRequest(engine)); monitor.confirm(attachment.id, attachment.revision, 1, "trigger", true)
  const tickets = new ExitTickets(engine, () => now); const request = { ...input(), recommendationId: engine.getSnapshot().recommendations[0].id }
  const first = tickets.stage(request, "copilot"); assert.equal(tickets.stage({ ...request, commandId: "request-002" }, "copilot").id, first.id)
  now += 61_000; tickets.cycle(); assert.equal(engine.getSnapshot().tickets[0].state, "invalidated")
  now = Date.now(); const explicit = tickets.stage({ ...input(), commandId: "request-003" }, "trader"); tickets.dismiss(explicit.id)
  assert.equal(engine.getSnapshot().tickets[1].state, "dismissed")
  assert.throws(() => tickets.stage({ ...input(), intent: "increase", commandId: "request-004" }, "trader"))
  assert.ok(engine.getSnapshot().tickets.every(ticket => ticket.state !== "approved"))
})
