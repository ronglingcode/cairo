import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { positionEngine } from "./fixtures/positions.mjs"
import { ExitTickets } from "../src/engine/ExitTickets.mts"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"
import { ExitWriter } from "../src/engine/ExitWriter.mts"
import { RecoveryStore } from "../src/engine/RecoveryStore.mts"
const intent = commandId => ({ intent: "close", accountId: "fixture", positionId: "position-0", symbol: "AAA", positionSide: "long", factsRevision: 1, quantity: 5, orderType: "market", reason: "fixture", commandId })
export async function writerFixture(t, response = { status: 201, body: "", headers: { location: "https://api.schwabapi.com/trader/v1/accounts/hash/orders/123" } }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo-writer-")); t.after(() => rm(root, { recursive: true, force: true }))
  const engine = positionEngine(); const tickets = new ExitTickets(engine); const recovery = new RecoveryStore(root); await recovery.load()
  const writes = []; const http = { request: async (url, init = {}) => {
    if (!init.method || init.method === "GET") return { status: 200, body: [{ accountNumber: "fixture", hashValue: "hash" }] }
    assert.ok(recovery.snapshot.attempts.length, "checkpoint must precede send"); writes.push({ url, ...init })
    if (response instanceof Error) throw response
    return response
  } }
  const tokens = { readForSelectedAccount: async () => ({ accessToken: "synthetic", accountId: "fixture", expiresAt: Date.now() + 60_000 }), invalidate: () => {} }
  const monitor = new ManagementMonitor(engine, new PositionGuidance(engine))
  const writer = new ExitWriter({ engine, tickets, recovery, monitor, http, tokens, refresh: async () => {} })
  return { engine, tickets, recovery, writer, writes, tokens, intent }
}
test("approved close checkpoints before send; concurrent replay writes once and acceptance is not fill", async t => {
  const f = await writerFixture(t); const ticket = f.tickets.stage(intent("writer-001"), "trader")
  await assert.rejects(f.writer.submit(ticket.id, ticket.reviewHash), /approval/); assert.equal(f.writes.length, 0)
  // Failed preflight commands cannot be reused; use a new exact draft/identity.
  const reviewed = f.tickets.stage(intent("writer-002"), "trader"); f.tickets.approve(reviewed.id, reviewed.reviewHash)
  const results = await Promise.all([f.writer.submit(reviewed.id, reviewed.reviewHash), f.writer.submit(reviewed.id, reviewed.reviewHash)])
  assert.equal(f.writes.length, 1); assert.equal(results[0].state, "accepted"); assert.equal(f.writer.reserved("fixture", "AAA"), 5)
  assert.equal((await f.writer.submit(reviewed.id, "generic allowance")).id, reviewed.id); assert.equal(f.writes.length, 1)
  const facts = f.engine.getSnapshot().brokerFacts; facts.recentFills.push({ fillId: "f", orderId: "123", symbol: "AAA", side: "sell", quantity: 5, price: 21, filledAt: new Date().toISOString() }); f.engine.updateSnapshot({ brokerFacts: facts }); f.writer.reconcileKnown()
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(f.recovery.snapshot.attempts[0].state, "filled"); assert.equal(f.writer.reserved("fixture", "AAA"), 0)
})
test("timeout-after-send and explicit rejection are distinct; unknown blocks further sends", async t => {
  for (const response of [new Error("timeout"), { status: 400, body: { error: "invalid" } }]) {
    const f = await writerFixture(t, response); const ticket = f.tickets.stage(intent("writer-003"), "trader"); f.tickets.approve(ticket.id, ticket.reviewHash)
    const result = await f.writer.submit(ticket.id, ticket.reviewHash); assert.equal(result.state, response instanceof Error ? "unknown" : "rejected")
    await f.writer.submit(ticket.id, ticket.reviewHash); assert.equal(f.writes.length, 1)
    if (response instanceof Error) { const another = f.tickets.stage(intent("writer-004"), "trader"); f.tickets.approve(another.id, another.reviewHash); await assert.rejects(f.writer.submit(another.id, another.reviewHash), /Uncertain/); assert.equal(f.writes.length, 1) }
  }
})
test("expired authorization and checkpoint failure prevent writes", async t => {
  const f = await writerFixture(t); const ticket = f.tickets.stage(intent("writer-005"), "trader"); f.tickets.approve(ticket.id, ticket.reviewHash)
  f.tokens.readForSelectedAccount = async () => null; await assert.rejects(f.writer.submit(ticket.id, ticket.reviewHash)); assert.equal(f.writes.length, 0)
  const g = await writerFixture(t); const reviewed = g.tickets.stage(intent("writer-006"), "trader"); g.tickets.approve(reviewed.id, reviewed.reviewHash)
  g.recovery.checkpoint = async () => { throw new Error("disk failed") }; await assert.rejects(g.writer.submit(reviewed.id, reviewed.reviewHash)); assert.equal(g.writes.length, 0)
})
