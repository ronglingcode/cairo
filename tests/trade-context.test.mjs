import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, cp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { tradeCandidates, positionTradebook } from "../src/engine/TradeContext.mts"
import { requiresTradeContext } from "../src/shared/SkillCommands.mts"
import { BookmapPatterns } from "../src/engine/BookmapPatterns.mts"
import { CairoDomainTools } from "../src/copilot/CairoDomainTools.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { PreparationStore } from "../src/engine/PreparationStore.mts"
import { positionEngine } from "./fixtures/positions.mjs"

test("shared position resolver handles stops, targets and management without chart inference", () => {
  const positions = positionEngine().getSnapshot().positions
  positions.push({ ...positions[0], positionId: "short-AAA", side: "short" })
  for (const command of ["set-stop-loss", "set-targets", "manage-trade"]) {
    assert.equal(requiresTradeContext(`/${command} AAA`), true)
    assert.equal(tradeCandidates(`/${command}`, positions).length, 3)
    assert.equal(tradeCandidates(`/${command} AAA`, positions).length, 2)
    assert.equal(tradeCandidates(`/${command} AAA short`, positions)[0].positionId, "short-AAA")
    assert.throws(() => tradeCandidates(`/${command} ZZZ`, positions), /No current ZZZ/)
  }
  assert.equal(requiresTradeContext("https://example.org/set-targets"), false)
})

test("symbol and broker side resolve the assigned book and preserve attachment conflicts", () => {
  const snapshot = positionEngine().getSnapshot()
  snapshot.preparation = { tradebookAssignments: [
    { symbol: "AAA", side: "long", tradebookId: "partial" },
    { symbol: "AAA", side: "short", tradebookId: "whole" },
  ] }
  const position = snapshot.positions[0]
  assert.equal(positionTradebook(snapshot, position).book.id, "partial")
  assert.equal(positionTradebook(snapshot, { ...position, side: "short" }).book.id, "whole")
  assert.equal(positionTradebook(snapshot, snapshot.positions[1]).status, "unassigned")
  snapshot.attachments = [{ accountId: "other-account", positionId: position.positionId, symbol: "AAA", state: "active", baseline: { side: "long" }, tradebookId: "whole" }]
  assert.equal(positionTradebook(snapshot, position).status, "resolved")
  snapshot.attachments[0].accountId = snapshot.brokerFacts.accountId
  assert.equal(positionTradebook(snapshot, position).status, "conflict")
  snapshot.preparation.tradebookAssignments = []
  assert.equal(positionTradebook(snapshot, position).book.id, "whole")
  assert.equal(positionTradebook(snapshot, { ...position, side: "short" }).status, "unassigned")
  snapshot.attachments = []
  snapshot.preparation.tradebookAssignments = [{ symbol: "AAA", side: "long", tradebookId: "removed" }]
  assert.equal(positionTradebook(snapshot, position).status, "missing-source")
})

test("position matching rejects inactive and wrong-side assignments even with an attachment", () => {
  const snapshot = positionEngine().getSnapshot()
  const position = snapshot.positions[0]
  snapshot.tradebooks[0].activeSides = ["long"]
  snapshot.tradebooks[1].activeSides = ["short"]
  snapshot.preparation = { tradebookAssignments: [{ symbol: "AAA", side: "long", tradebookId: "whole" }] }
  assert.equal(positionTradebook(snapshot, position).status, "missing-source")
  snapshot.preparation.tradebookAssignments[0].tradebookId = "partial"
  assert.equal(positionTradebook(snapshot, position).book.id, "partial")
  snapshot.attachments = [{ accountId: snapshot.brokerFacts.accountId, positionId: position.positionId, symbol: "AAA", state: "active", baseline: { side: "long" }, tradebookId: "partial" }]
  snapshot.tradebooks = snapshot.tradebooks.filter(book => book.id !== "partial")
  assert.equal(positionTradebook(snapshot, position).status, "missing-source")
  assert.equal(positionTradebook(snapshot, position).book, null)
})

test("assignments persist, reject duplicate sides, and survive AI note proposals", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo-context-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new PreparationStore(root)
  const assignments = [{ symbol: "AAA", side: "long", tradebookId: "partial" }, { symbol: "AAA", side: "short", tradebookId: "whole" }]
  const content = { markdown: "My plan", date: null, symbol: "AAA", tradebookAssignments: assignments }
  const saved = await store.save(content, null)
  assert.deepEqual((await new PreparationStore(root).load()).tradebookAssignments, assignments)
  await assert.rejects(store.save({ ...content, tradebookAssignments: [...assignments, assignments[0]] }, saved.revision), /at most one tradebook/)
  const engine = positionEngine()
  engine.updateSnapshot({ preparation: saved })
  const tools = new CairoDomainTools(engine, async () => true)
  const proposal = await tools.execute("propose_notes", { markdown: "Updated plan", date: null, symbol: "AAA", expectedRevision: saved.revision }, "session")
  assert.deepEqual(proposal.proposal.content.tradebookAssignments, assignments)
  assert.deepEqual(engine.getSnapshot().preparation, saved)
})

test("all management commands gate before AI, then read the same confirmed trade context", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo-context-"))
  const source = path.join(root, "source")
  await cp(path.resolve("../Backtest/tradebooks/bookmap_patterns"), path.join(source, "bookmap_patterns"), { recursive: true })
  const engine = positionEngine()
  const patterns = new BookmapPatterns(engine, root, source)
  await patterns.load()
  const api = new EngineApiServer(engine)
  api.setBookmapPatterns(patterns)
  const sent = []
  api.setCopilotChat({ snapshot: { busy: false }, send: async (...args) => sent.push(args) })
  const base = await api.start()
  t.after(async () => { patterns.stop(); await api.stop(); await rm(root, { recursive: true, force: true }) })
  const post = (route, body) => fetch(base + route, { method: "POST", headers: { Authorization: `Bearer ${api.commandToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
  for (const command of ["set-stop-loss", "set-targets", "manage-trade"]) {
    const response = await post("/copilot/send", { text: `/${command} AAA`, commandId: `context-${command}` })
    assert.equal((await response.json()).patternSelectionRequired, true)
    assert.equal(sent.length, 0)
    patterns.cancel(engine.getSnapshot().bookmapPatternPicker.id)
  }
  const prepared = await patterns.preflight("/set-targets AAA", "context-select-001")
  assert.equal((await post("/bookmap-pattern/select", { pickerId: prepared.picker.id, positionId: "position-0", patternId: "bid-step-up" })).status, 200)
  assert.match(sent[0][0], /Selected current trade: AAA long; positionId: position-0/)
  for (const command of ["set-stop-loss", "set-targets", "manage-trade"]) assert.equal((await patterns.preflight(`/${command} AAA`, `tagged-${command}`)).picker, null)
  engine.updateSnapshot({ preparation: { tradebookAssignments: [{ symbol: "AAA", side: "long", tradebookId: "partial" }] } })
  const tools = new CairoDomainTools(engine, async () => true)
  tools.setBookmapPatterns(patterns)
  const context = await tools.execute("read_trade_context", { positionId: "position-0" }, "session")
  assert.equal(context.bookmapPattern.confirmed, true)
  assert.equal(context.tradebook.book.id, "partial")
  assert.equal(context.accountId, "fixture")
  assert.equal(context.position.side, "long")
  assert.equal(engine.getSnapshot().tickets.length, 0)
})
