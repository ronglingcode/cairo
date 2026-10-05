import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { TradebookStore } from "../src/engine/TradebookStore.mts"

const digest = (value) => createHash("sha256").update(value).digest("hex")
const draft = (markdown = "# Gap Give and Go\n\nWait for a bid to reappear.") => ({
  id: "gap-give-go", title: "Gap Give and Go", markdown,
  interpretation: { tradebookId: "gap-give-go", narrativeHash: digest(markdown), clauses: [{ clauseId: "bid-reappears", sourceText: "Wait for a bid to reappear.", coverage: "human", explanation: "Trader confirms the pattern." }] },
})

test("tradebook pair activates only when the narrative and interpretation match, then reopens", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo artifacts "))
  try {
    const store = new TradebookStore(root)
    store.stageDraft(draft())
    const saved = await store.activateDraft("gap-give-go", null)
    assert.equal(saved.interpretation.clauses[0].clauseId, "bid-reappears")
    assert.equal((await store.loadTradebook(saved.id)).revision, saved.revision)
    assert.equal(store.getDraft(saved.id), null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("invalid clause links, stale replacements, and concurrent replacement are rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo artifacts "))
  try {
    const store = new TradebookStore(root)
    assert.throws(() => store.stageDraft(draft("# Setup\nNo matching clause.")), /not linked/)
    store.stageDraft(draft())
    const initial = await store.activateDraft("gap-give-go", null)
    store.stageDraft(draft("# Gap Give and Go\n\nWait for a bid to reappear.\nAvoid a chase."))
    const results = await Promise.allSettled([
      store.activateDraft("gap-give-go", initial.revision),
      store.activateDraft("gap-give-go", initial.revision),
    ])
    assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1)
    assert.equal(results.filter((entry) => entry.status === "rejected").length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("active plan replacement uses revision compare-and-swap", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo plan "))
  try {
    const store = new TradebookStore(root)
    const attachment = { id: "attach-1", accountId: "acct-2", symbol: "XYZ", positionId: "pos-1", tradebookId: "book-1", tradebookRevision: "rev-1", narrativeHash: "hash-1", interpretation: { tradebookId: "book-1", narrativeHash: "hash-1", clauses: [] }, state: "pending-confirmation" }
    const saved = await store.savePlan(attachment, null)
    assert.deepEqual(await store.loadPlan(), saved)
    await assert.rejects(store.savePlan({ ...attachment, state: "active" }, null), /changed/)
    const updated = await store.savePlan({ ...attachment, state: "active" }, saved.revision)
    assert.notEqual(updated.revision, saved.revision)
  } finally { await rm(root, { recursive: true, force: true }) }
})

