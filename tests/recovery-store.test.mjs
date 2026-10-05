import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { RecoveryStore } from "../src/engine/RecoveryStore.mts"
import { ExitTickets } from "../src/engine/ExitTickets.mts"
import { positionEngine } from "./fixtures/positions.mjs"
function attempt() { const engine = positionEngine(); const tickets = new ExitTickets(engine); const ticket = tickets.stage({ intent: "close", accountId: "fixture", positionId: "position-0", symbol: "AAA", positionSide: "long", factsRevision: 1, quantity: 5, orderType: "market", reason: "fixture", commandId: "recovery-001" }, "trader"); return { id: ticket.id, ticket, attemptedAt: new Date().toISOString(), brokerOrderId: null, state: "checkpointed", filledQuantity: 0, detail: "Before send" } }
test("checkpoint survives reopening; corrupt files and failed writes block sending", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo-recovery-"))
  try {
    const store = new RecoveryStore(root); await store.load(); const item = attempt(); await store.checkpoint(item, [], [])
    const reopened = new RecoveryStore(root); assert.equal((await reopened.load()).attempts[0].state, "checkpointed")
    await assert.rejects(store.checkpoint(item, [], []), /already/)
    await writeFile(store.file, "{broken"); const corrupt = new RecoveryStore(root); await assert.rejects(corrupt.load(), /corrupt/); await assert.rejects(corrupt.checkpoint(attempt(), [], []), /blocked/)
    const blockedPath = path.join(root, "blocked"); const blocked = new RecoveryStore(blockedPath); await blocked.load(); await writeFile(blockedPath, "file")
    await assert.rejects(blocked.checkpoint(attempt(), [], [])); assert.equal(blocked.snapshot.attempts.length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test("pruning retains unresolved attempts and cannot silently exceed the bound", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo-prune-"))
  try { const store = new RecoveryStore(root); await store.load(); const base = attempt()
    const items = Array.from({ length: 99 }, (_, index) => ({ ...structuredClone(base), id: `id-${index}`, ticket: { ...base.ticket, id: `id-${index}` }, state: "unknown" }))
    await store.change(() => ({ version: 1, attempts: items, attachments: [], rules: [] }))
    await store.checkpoint(base, [], []); assert.equal(store.snapshot.attempts.length, 100)
    await assert.rejects(store.checkpoint({ ...base, id: "extra", ticket: { ...base.ticket, id: "extra" } }, [], [])); assert.equal(store.snapshot.attempts.length, 100)
  } finally { await rm(root, { recursive: true, force: true }) }
})
