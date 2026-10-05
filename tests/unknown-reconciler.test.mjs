import test from "node:test"
import assert from "node:assert/strict"
import { writerFixture } from "./exit-writer.test.mjs"
import { UnknownReconciler } from "../src/engine/UnknownReconciler.mts"
const rawOrder = (id, at, status = "WORKING", filled = 0) => ({ orderId: id, enteredTime: at, status, quantity: 5, filledQuantity: filled, orderType: "MARKET", session: "NORMAL", duration: "DAY", orderStrategyType: "SINGLE", orderLegCollection: [{ legId: 1, quantity: 5, instruction: "SELL", positionEffect: "CLOSING", instrument: { symbol: "AAA", assetType: "EQUITY" } }] })
test("missing-ID matching remains uncertain until reviewed identity; read-only reconciliation never resends", async t => {
  const f = await writerFixture(t, new Error("timeout")); const ticket = f.tickets.stage(f.intent("unknown-001"), "trader"); f.tickets.approve(ticket.id, ticket.reviewHash); await f.writer.submit(ticket.id, ticket.reviewHash)
  const attempt = f.recovery.snapshot.attempts[0]; const raw = rawOrder(123, attempt.attemptedAt)
  const reads = []; const http = { request: async url => { reads.push(url); return { status: 200, body: url.includes("?") ? [raw] : raw } } }
  const reconciler = new UnknownReconciler(f.engine, f.recovery, http, f.tokens); await reconciler.reconcile()
  assert.equal(f.recovery.snapshot.attempts[0].state, "unknown"); assert.match(f.recovery.snapshot.attempts[0].detail, /confirm identity/)
  await assert.rejects(reconciler.confirmIdentity(attempt.id, "123", false), /Explicit/)
  await reconciler.confirmIdentity(attempt.id, "123", true); assert.equal(f.recovery.snapshot.attempts[0].state, "working"); assert.equal(f.writes.length, 1)
  raw.status = "FILLED"; raw.filledQuantity = 5
  const next = new UnknownReconciler(f.engine, f.recovery, http, f.tokens); await next.reconcile(); assert.equal(f.recovery.snapshot.attempts[0].state, "filled")
  assert.ok(reads.every(url => url.startsWith("https://api.schwabapi.com/")))
})
test("duplicate-looking orders and absent visibility preserve blocked quantity", async t => {
  const f = await writerFixture(t, new Error("timeout")); const ticket = f.tickets.stage(f.intent("unknown-002"), "trader"); f.tickets.approve(ticket.id, ticket.reviewHash); await f.writer.submit(ticket.id, ticket.reviewHash)
  const attempt = f.recovery.snapshot.attempts[0]
  const http = { request: async () => ({ status: 200, body: [rawOrder(123, attempt.attemptedAt), rawOrder(124, attempt.attemptedAt)] }) }
  await new UnknownReconciler(f.engine, f.recovery, http, f.tokens).reconcile(); assert.match(f.recovery.snapshot.attempts[0].detail, /Multiple/)
  http.request = async () => ({ status: 200, body: [] }); await new UnknownReconciler(f.engine, f.recovery, http, f.tokens).reconcile()
  assert.equal(f.writer.reserved("fixture", "AAA"), 5); assert.equal(f.writes.length, 1); assert.match(f.recovery.snapshot.attempts[0].detail, /No matching/)
})
