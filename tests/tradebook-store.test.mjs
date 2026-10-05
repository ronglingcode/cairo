import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { TradebookStore } from "../src/engine/TradebookStore.mts"

const digest = (value) => createHash("sha256").update(value).digest("hex")
const draft = (markdown = "# Gap Give and Go\n\nWait for a bid to reappear.") => ({
  id: "gap-give-go", title: "Gap Give and Go", markdown,
  interpretation: { tradebookId: "gap-give-go", narrativeHash: digest(markdown), clauses: [{ clauseId: "bid-reappears", sourceText: "Wait for a bid to reappear.", coverage: "human", explanation: "Trader confirms the pattern." }] },
})

test("source library includes only top-level strategies, without requiring interpretations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo source "))
  try {
    const source = path.join(root, "strategies")
    await mkdir(path.join(source, "patterns"), { recursive: true })
    await writeFile(path.join(source, "gap-give-go.md"), draft().markdown)
    await writeFile(path.join(source, "another.md"), "# Another setup\nOriginal strategy")
    await writeFile(path.join(source, "index.md"), "# Index")
    await writeFile(path.join(source, "notes.txt"), "Not a strategy")
    await writeFile(path.join(source, "patterns", "bid.md"), "# Bid")
    const store = new TradebookStore(root, source)
    const books = await store.list()
    assert.deepEqual(books.map(book => book.id), ["another", "gap-give-go"])
    assert.equal(books[1].title, "Gap Give and Go")
    assert.equal(books[1].interpretation, null)
    await mkdir(store.root, { recursive: true })
    await writeFile(path.join(store.root, "gap-give-go.interpretation.json"), JSON.stringify(draft().interpretation))
    const reviewed = await store.loadTradebook("gap-give-go")
    assert.equal(reviewed.interpretation.clauses.length, 1)
    assert.equal(await readFile(path.join(source, "gap-give-go.md"), "utf8"), draft().markdown)
    const updated = draft().markdown + "\nNew authored rule."
    await writeFile(path.join(source, "gap-give-go.md"), updated)
    const changed = await store.loadTradebook("gap-give-go")
    assert.equal(changed.markdown, updated)
    assert.equal(changed.interpretation, null)
    assert.notEqual(changed.revision, reviewed.revision)
    await writeFile(path.join(store.root, "gap-give-go.md"), draft().markdown)
    await rm(path.join(source, "gap-give-go.md"))
    assert.equal(await store.loadTradebook("gap-give-go"), null)
    assert.deepEqual((await store.list()).map(book => book.id), ["another"])
    for (const method of ["stageDraft", "getDraft", "activateDraft"]) assert.equal(store[method], undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("missing source folder never falls back to profile tradebooks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo-read-only-"))
  try {
    const store = new TradebookStore(root, path.join(root, "missing"))
    await mkdir(store.root, { recursive: true })
    await writeFile(path.join(store.root, "gap-give-go.md"), draft().markdown)
    assert.equal(await store.loadTradebook("gap-give-go"), null)
    await assert.rejects(store.list(), { code: "ENOENT" })
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

