import test from "node:test"
import assert from "node:assert/strict"
import { positionEngine } from "./fixtures/positions.mjs"
import { ExitTickets } from "../src/engine/ExitTickets.mts"
const request = () => ({ intent: "close", accountId: "fixture", positionId: "position-0", symbol: "AAA", positionSide: "long", factsRevision: 1, quantity: 5, orderType: "market", reason: "Reviewed exit", commandId: "approval-001" })
test("approval binds exact details, repeats once, and is consumed only once", () => {
  const engine = positionEngine(); const tickets = new ExitTickets(engine); const ticket = tickets.stage(request(), "trader")
  assert.throws(() => tickets.approve(ticket.id, "generic allow"))
  tickets.approve(ticket.id, ticket.reviewHash); tickets.approve(ticket.id, ticket.reviewHash)
  assert.equal(engine.getSnapshot().tickets[0].state, "approved")
  tickets.consumeApproval(ticket.id, ticket.reviewHash)
  assert.throws(() => tickets.consumeApproval(ticket.id, ticket.reviewHash), /Unused/)
})
test("expired, dismissed, changed facts or changed payload never approve", () => {
  for (const mode of ["expired", "dismissed", "facts", "payload"]) {
    const engine = positionEngine(); let now = Date.now(); const tickets = new ExitTickets(engine, () => now); const ticket = tickets.stage(request(), "trader")
    if (mode === "expired") now += 61_000
    if (mode === "dismissed") tickets.dismiss(ticket.id)
    if (mode === "facts") { const facts = engine.getSnapshot().brokerFacts; facts.positions[0].quantity = 9; engine.updateSnapshot({ brokerFacts: facts }) }
    if (mode === "payload") { const current = engine.getSnapshot().tickets; current[0].exactPayload.orderLegCollection[0].quantity = 6; engine.updateSnapshot({ tickets: current }) }
    assert.throws(() => tickets.approve(ticket.id, ticket.reviewHash))
  }
})
