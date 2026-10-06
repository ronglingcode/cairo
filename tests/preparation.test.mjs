import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PreparationStore, PreparationConflictError, PreparationValidationError } from "../src/engine/PreparationStore.mts"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "Cairo preparation "))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, store: new PreparationStore(directory) }
}

test("preparation migrates beneath document root without overwriting either source", async t => {
  const { directory, store: legacy } = await setup(t)
  const original = await legacy.save({ markdown: "Legacy notes", date: null, symbol: null }, null)
  const root = path.join(directory, "documents")
  const migrated = await PreparationStore.forTradebooksRoot(root, directory)
  assert.deepEqual(await migrated.load(), original)
  assert.deepEqual(await legacy.load(), original)
  const updated = await migrated.save({ markdown: "Root notes", date: null, symbol: null }, original.revision)
  assert.deepEqual(await (await PreparationStore.forTradebooksRoot(root, directory)).load(), updated)
  assert.deepEqual(await legacy.load(), original)
  assert.equal(JSON.parse(await readFile(path.join(root, "preparation", "preparation.json"), "utf8")).markdown, "Root notes")
})

test("preparation retains original wording and reopens without an interpretation or AI", async t => {
  const { directory, store } = await setup(t)
  assert.equal(await store.load(), null)
  const markdown = "# Premarket\r\n\r\nSPY: wait and reassess.  \r\n不追高\r\n"
  const content = { markdown, date: null, symbol: null }
  const saved = await store.save(content, null)
  assert.equal(saved.markdown, markdown)
  assert.deepEqual(await new PreparationStore(directory).load(), saved)
  assert.equal("interpretation" in saved, false)
  assert.equal((await store.save(content, saved.revision)).revision, saved.revision)
})

test("concurrent stale preparation saves cannot replace the winning revision", async t => {
  const { store } = await setup(t)
  const initial = await store.save({ markdown: "Original", date: "2026-10-04", symbol: "SPY" }, null)
  const results = await Promise.allSettled([
    store.save({ markdown: "First edit", date: null, symbol: null }, initial.revision),
    store.save({ markdown: "Second edit", date: null, symbol: null }, initial.revision),
  ])
  assert.equal(results[0].status, "fulfilled")
  assert.equal(results[1].status, "rejected")
  assert.ok(results[1].reason instanceof PreparationConflictError)
  assert.equal((await store.load()).markdown, "First edit")
})

test("invalid content and corrupted saved preparation are rejected without overwriting", async t => {
  const { directory, store } = await setup(t)
  await assert.rejects(store.save({ markdown: "Notes", date: "2026-02-30", symbol: null }, null), PreparationValidationError)
  await assert.rejects(store.save({ markdown: "Notes", date: null, symbol: "../secret" }, null), PreparationValidationError)
  await assert.rejects(store.save({ markdown: "x".repeat(65_537), date: null, symbol: null }, null), PreparationValidationError)
  const file = path.join(directory, "preparation.json")
  await writeFile(file, "corrupt existing notes", "utf8")
  await assert.rejects(store.load())
  await assert.rejects(store.save({ markdown: "Replacement", date: null, symbol: null }, null))
  assert.equal(await readFile(file, "utf8"), "corrupt existing notes")
})

test("preparation API requires capability, rejects stale edits, and leaves attached guidance untouched", async t => {
  const { store } = await setup(t)
  const engine = new CairoEngine()
  engine.updateSnapshot({ attachments: [{ id: "existing-position-policy", state: "active" }], tickets: [{ id: "existing-ticket" }] })
  const before = engine.getSnapshot()
  const api = new EngineApiServer(engine)
  api.setPreparationStore(store)
  await api.loadPreparation()
  const url = await api.start()
  t.after(() => api.stop())
  const payload = { content: { markdown: "My preparation\n", date: null, symbol: null }, expectedRevision: null }
  assert.equal((await fetch(`${url}/preparation`, { method: "POST", body: JSON.stringify(payload) })).status, 403)
  const post = body => fetch(`${url}/preparation`, { method: "POST", headers: { Authorization: `Bearer ${api.commandToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const saved = await post(payload)
  assert.equal(saved.status, 200)
  const savedNotes = (await saved.json()).preparation
  assert.equal(engine.getSnapshot().preparation.markdown, payload.content.markdown)
  assert.deepEqual(engine.getSnapshot().attachments, before.attachments)
  assert.deepEqual(engine.getSnapshot().tickets, before.tickets)
  assert.equal((await post({ ...payload, content: { ...payload.content, markdown: "stale edit" } })).status, 409)
  assert.equal((await (await fetch(`${url}/preparation`)).json()).preparation.revision, savedNotes.revision)
  assert.equal((await post({ content: [] })).status, 400)
})

test("preparation read failures expose an error while retaining the last known notes", async t => {
  const { directory, store } = await setup(t)
  const saved = await store.save({ markdown: "Preserve these notes", date: null, symbol: null }, null)
  const engine = new CairoEngine()
  const api = new EngineApiServer(engine)
  api.setPreparationStore(store)
  assert.equal(await api.loadPreparation(), true)
  await writeFile(path.join(directory, "preparation.json"), "broken", "utf8")
  assert.equal(await api.loadPreparation(), false)
  assert.deepEqual(engine.getSnapshot().preparation, saved)
  assert.match(engine.getSnapshot().preparationError, /could not be read/)
  assert.equal(engine.canSubmitOrders, false)
})
