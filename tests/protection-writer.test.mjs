import test from "node:test"
import assert from "node:assert/strict"
import { writerFixture } from "./exit-writer.test.mjs"
const stop = { orderId: "77", symbol: "AAA", side: "sell", quantity: 10, filledQuantity: 0, status: "working", orderType: "STOP", parentOrderId: null, ocoGroupId: null, positionEffect: "CLOSING", instruction: "SELL", session: "NORMAL", duration: "DAY", strategy: "SINGLE", legCount: 1 }
function protect(f) { const facts = f.engine.getSnapshot().brokerFacts; facts.workingOrders = [structuredClone(stop)]; f.engine.updateSnapshot({ brokerFacts: facts }); return facts }
test("exact cancel acknowledgement waits for final broker state and sends one DELETE", async t => {
  const f = await writerFixture(t, { status: 200, body: "" }); const facts = protect(f)
  const input = { ...f.intent("protect-001"), intent: "cancel-protection", orderId: "77", quantity: 10 }; delete input.orderType
  const ticket = f.tickets.stage(input, "trader"); f.tickets.approve(ticket.id, ticket.reviewHash)
  assert.equal((await f.writer.submit(ticket.id, ticket.reviewHash)).state, "accepted")
  assert.equal(f.writes[0].method, "DELETE"); assert.ok(f.writes[0].url.endsWith("/77")); assert.equal(f.writes[0].body, undefined)
  await f.writer.submit(ticket.id, ticket.reviewHash); assert.equal(f.writes.length, 1)
  facts.workingOrders[0].status = "canceled"; f.engine.updateSnapshot({ brokerFacts: facts }); f.writer.reconcileKnown(); await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(f.recovery.snapshot.attempts[0].state, "canceled")
})
test("replacement is exact PUT; OCO and timed-out protection changes stay blocked", async t => {
  const f = await writerFixture(t); const facts = protect(f)
  const input = { ...f.intent("protect-002"), intent: "replace-protection", orderId: "77", quantity: 10, orderType: "stop", stopPrice: 19.5 }
  const ticket = f.tickets.stage(input, "trader"); f.tickets.approve(ticket.id, ticket.reviewHash); await f.writer.submit(ticket.id, ticket.reviewHash)
  assert.equal(f.writes[0].method, "PUT"); assert.equal(JSON.parse(f.writes[0].body).stopPrice, "19.50")
  const g = await writerFixture(t, new Error("timeout")); protect(g); const uncertain = g.tickets.stage({ ...input, commandId: "protect-003" }, "trader"); g.tickets.approve(uncertain.id, uncertain.reviewHash)
  assert.equal((await g.writer.submit(uncertain.id, uncertain.reviewHash)).state, "unknown"); await g.writer.submit(uncertain.id, uncertain.reviewHash); assert.equal(g.writes.length, 1)
  facts.workingOrders[0].ocoGroupId = "oco"; f.engine.updateSnapshot({ brokerFacts: facts })
  assert.throws(() => f.tickets.stage({ ...input, commandId: "protect-004" }, "trader"), /Unsupported/)
})
