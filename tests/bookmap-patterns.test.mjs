import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BookmapPatterns, parseActivePatterns } from "../src/engine/BookmapPatterns.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { CairoDomainTools } from "../src/copilot/CairoDomainTools.mts"
import { positionEngine } from "./fixtures/positions.mjs"
import { PartialManagement } from "../src/copilot/PartialManagement.mts"

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo-patterns-"))
  const source = path.join(root, "tradebooks")
  // Isolated library fixture: trader-authored catalogs may change independently of these tests.
  await mkdir(path.join(source,"bookmap_patterns"),{recursive:true})
  await writeFile(path.join(source,"bookmap_patterns/activePatterns.md"), `## Long
| ID | Pattern | Tradebook |
| --- | --- | --- |
| bid-vwap-shape-recovery | bid vwap shape recovery | — |
| bid-reappear | bid reappear | [Bid reappear](bid_reappear.md) |
| bid-step-up | bid step up | [Bid step up](bid_step_up.md) |
## Short
| ID | Pattern | Tradebook |
| --- | --- | --- |
| bid-breakdown | bid breakdown | — |
`)
  await writeFile(path.join(source,"bookmap_patterns/bid_step_up.md"),"# Bid Step Up\n* Stop loss: low of the day\n")
  await writeFile(path.join(source,"bookmap_patterns/bid_reappear.md"),"# Bid Reappear\n* Setup: bid reappears\n")
  const engine = positionEngine()
  const snapshot = engine.getSnapshot()
  snapshot.brokerFacts.positions[1].side = "short"
  engine.updateSnapshot({ positions: snapshot.brokerFacts.positions, brokerFacts: snapshot.brokerFacts })
  const patterns = new BookmapPatterns(engine, root, source)
  await patterns.load()
  t.after(async () => { patterns.stop(); await rm(root, { recursive: true, force: true }) })
  return { root, source, engine, patterns }
}
function updatePositions(engine, positions, accountId = "fixture") {
  const facts = engine.getSnapshot().brokerFacts
  facts.accountId = accountId; facts.positions = positions; facts.asOf = new Date().toISOString()
  engine.updateSnapshot({ positions, brokerFacts: facts, brokerFactsRevision: engine.getSnapshot().brokerFactsRevision + 1 })
}

test("active catalog filters each side and routes only the tagged pattern's source", async t => {
  const { patterns, engine, source } = await fixture(t)
  const result = await patterns.preflight("/set-stop-loss", "pattern-command-001")
  assert.equal(result.picker.positions.length, 2)
  assert.deepEqual(result.picker.positions[0].candidates.map(pattern => pattern.name), ["bid vwap shape recovery", "bid reappear", "bid step up"])
  assert.deepEqual(result.picker.positions[1].candidates.map(pattern => pattern.name), ["bid breakdown"])
  await assert.rejects(patterns.select({ pickerId: result.picker.id, positionId: "position-0", patternId: "bid-breakdown" }), /no longer active/)
  const selected = await patterns.select({ pickerId: result.picker.id, positionId: "position-0", patternId: "bid-step-up" })
  assert.match(selected.text, /Selected current trade: AAA long; positionId: position-0/)
  assert.match(selected.text, /Bookmap pattern: bid step up \(saved\)$/)
  assert.equal(engine.getSnapshot().bookmapPatternPicker, null)
  const routed = await patterns.read("position-0")
  assert.equal(routed.confirmed, true)
  assert.equal(routed.source, "bookmap_patterns/bid_step_up.md")
  assert.match(routed.markdown, /low of the day/)
  const reused = await patterns.preflight("/set-stop-loss AAA", "pattern-command-002")
  assert.equal(reused.picker, null)
  assert.match(reused.text, /Bookmap pattern: bid step up \(saved\)$/)
  assert.match(await patterns.managementRequest("position-0"), /^\/manage-trade AAA long\nSelected current trade: AAA long; positionId: position-0\. Bookmap pattern: bid step up \(saved\)\nAutomatic review/)
  await assert.rejects(patterns.managementRequest("position-1"), /Tag or confirm the Bookmap pattern first/)
  assert.equal(engine.getSnapshot().bookmapPatternPicker, null, "automatic review never blocks the manual composer with a picker")
  updatePositions(engine, engine.getSnapshot().positions.map(position => ({ ...position, quantity: 5 })))
  assert.equal((await patterns.read("position-0")).confirmed, true)
  await assert.rejects(patterns.preflight("/set-stop-loss ZZZ", "pattern-command-011"), /No current ZZZ/)
  // Source edits are visible on the next invocation, without stale rule caching.
  await writeFile(path.join(source, "bookmap_patterns/bid_step_up.md"), "# Bid Step Up\n\n* Stop loss: updated trader rule\n")
  assert.match((await patterns.read("position-0")).markdown, /updated trader rule/)
  const tools = new CairoDomainTools(engine, async () => true)
  tools.setBookmapPatterns(patterns)
  assert.equal((await tools.execute("read_bookmap_pattern", { positionId: "position-0" }, "session")).pattern.id, "bid-step-up")
  await assert.rejects(tools.execute("read_bookmap_pattern", { positionId: "position-0" }, ""), /session/)
})

test("30% partial -> remind to tag -> confirmation -> automatic management without blocking manual chat", async t => {
  const {engine,patterns}=await fixture(t)
  const baseline=engine.getSnapshot().brokerFacts;baseline.asOf=new Date(Date.now()-1000).toISOString();engine.updateSnapshot({brokerFacts:baseline})
  const sent=[],alerts=[]
  const manager=new PartialManagement(engine,{snapshot:{connected:true,busy:false,outcome:null,messages:[]},sendAutomatic:async text=>sent.push(text)},id=>patterns.managementRequest(id),(...args)=>alerts.push(args),Date.now,id=>patterns.managementPicker(id))
  const facts=engine.getSnapshot().brokerFacts;facts.positions[0].quantity=7;facts.recentFills=[{fillId:"partial",orderId:"exit",symbol:"AAA",side:"sell",quantity:3,price:21,filledAt:new Date(Date.now()-1).toISOString()}]
  facts.asOf=new Date().toISOString();engine.updateSnapshot({brokerFacts:facts});manager.cycle()
  for(let i=0;i<100 && !engine.getSnapshot().copilotPartialManagement.notice;i++)await new Promise(resolve=>setTimeout(resolve,5))
  assert.deepEqual(sent,[])
  assert.deepEqual(engine.getSnapshot().copilotPartialManagement.waitingForPattern,["AAA"])
  assert.match(engine.getSnapshot().copilotPartialManagement.notice.text,/management will run automatically after confirmation/)
  assert.deepEqual(alerts,[["AAA",true]])
  const api=new EngineApiServer(engine);api.setBookmapPatterns(patterns);api.setPartialManagement(manager)
  api.setCopilotChat({snapshot:{busy:true},send:async()=>assert.fail("must not send to busy manual chat")})
  const base=await api.start();t.after(()=>api.stop())
  const post=(route,body,token=api.commandToken)=>fetch(`${base}${route}`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)})
  assert.equal((await post("/copilot/partial-management/tag",{positionId:"position-0"},api.toolToken)).status,403)
  assert.equal((await post("/copilot/partial-management/tag",{positionId:"position-1"})).status,400)
  assert.equal((await post("/copilot/partial-management/tag",{positionId:"position-0"})).status,200)
  const picker=engine.getSnapshot().bookmapPatternPicker
  assert.equal(picker.origin,"partial-management")
  assert.equal(picker.manual,true)
  assert.equal((await post("/bookmap-pattern/select",{pickerId:picker.id,positionId:"position-0",patternId:"bid-step-up"})).status,200)
  manager.cycle()
  for(let i=0;i<100 && !sent.length;i++)await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(sent.length,1)
  assert.match(sent[0],/Bookmap pattern: bid step up \(saved\)/)
  assert.deepEqual(engine.getSnapshot().copilotPartialManagement.waitingForPattern,[])
  assert.equal(engine.getSnapshot().copilotPartialManagement.notice,undefined)
  for(let i=0;i<10;i++)manager.cycle()
  assert.equal(sent.length,1,"confirmation resumes the original review exactly once")
})

test("manual tagging persists, reconfirms on restart and preserves undefined source/rule gaps", async t => {
  const { root, source, engine, patterns } = await fixture(t)
  const picker = (await patterns.preflight("/bookmap-pattern BBB", "pattern-command-003")).picker
  assert.equal(picker.positions.length, 1)
  const result = await patterns.select({ pickerId: picker.id, positionId: "position-1", patternId: "bid-breakdown" })
  assert.equal(result.manual, true)
  assert.equal((await patterns.read("position-1")).markdown, null)
  assert.equal(JSON.parse(await readFile(patterns.file, "utf8")).tags[0].patternId, "bid-breakdown")
  patterns.stop()
  const restarted = positionEngine()
  const positions = engine.getSnapshot().positions
  updatePositions(restarted, positions)
  const restored = new BookmapPatterns(restarted, root, source)
  await restored.load(); t.after(() => restored.stop())
  assert.equal((await restored.read("position-1")).confirmed, false)
  const confirm = (await restored.preflight("/set-stop-loss BBB", "pattern-command-004")).picker
  assert.equal(confirm.positions[0].tag.patternId, "bid-breakdown")
  await restored.select({ pickerId: confirm.id, positionId: "position-1", patternId: "bid-breakdown" })
  assert.equal((await restored.read("position-1")).confirmed, true)
  const long = (await restored.preflight("/bookmap-pattern AAA", "pattern-command-005")).picker
  await restored.select({ pickerId: long.id, positionId: "position-0", patternId: "bid-reappear" })
  const read = await restored.read("position-0")
  assert.equal(read.source, "bookmap_patterns/bid_reappear.md")
  assert.doesNotMatch(read.markdown, /stop loss/i)
})

test("flat/reopened trades, changed accounts, retired patterns and stale facts invalidate selection", async t => {
  const { engine, patterns, source } = await fixture(t)
  const positions = engine.getSnapshot().positions
  const picker = (await patterns.preflight("/set-stop-loss AAA", "pattern-command-006")).picker
  updatePositions(engine, [positions[1]])
  updatePositions(engine, positions)
  await assert.rejects(patterns.select({ pickerId: picker.id, positionId: "position-0", patternId: "bid-step-up" }), /no longer held/)
  const next = (await patterns.preflight("/set-stop-loss AAA", "pattern-command-007")).picker
  await patterns.select({ pickerId: next.id, positionId: "position-0", patternId: "bid-step-up" })
  updatePositions(engine, [positions[1]])
  updatePositions(engine, positions)
  assert.equal((await patterns.read("position-0")).confirmed, false)
  const afterClose = (await patterns.preflight("/set-stop-loss AAA", "pattern-command-008")).picker
  updatePositions(engine, positions, "another-account")
  await assert.rejects(patterns.select({ pickerId: afterClose.id, positionId: "position-0", patternId: "bid-step-up" }), /no longer held/)
  assert.equal((await patterns.read("position-0")).tag, null)
  const pending = (await patterns.preflight("/bookmap-pattern AAA", "pattern-command-009")).picker
  const catalogFile = path.join(source, "bookmap_patterns/activePatterns.md")
  await writeFile(catalogFile, (await readFile(catalogFile, "utf8")).replace(/^\| bid-step-up [^\n]*\n/m, ""))
  await assert.rejects(patterns.select({ pickerId: pending.id, positionId: "position-0", patternId: "bid-step-up" }), /no longer active/)
  const facts = engine.getSnapshot().brokerFacts
  facts.asOf = new Date(Date.now() - 120_000).toISOString()
  engine.updateSnapshot({ brokerFacts: facts })
  await assert.rejects(patterns.preflight("/set-stop-loss", "pattern-command-010"), /Refresh the account/)
})

test("API opens a shared picker, requires trader token, saves and resumes the exact trade request", async t => {
  const { engine, patterns } = await fixture(t)
  const api = new EngineApiServer(engine)
  api.setBookmapPatterns(patterns)
  const sent = []
  api.setCopilotChat({ snapshot: { busy: false }, send: async (...args) => { sent.push(args) } })
  const base = await api.start(); t.after(() => api.stop())
  const post = async (route, body, token = api.commandToken) => fetch(`${base}${route}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const request = { text: "/set-stop-loss AAA", commandId: "pattern-api-command-001" }
  assert.equal((await post("/copilot/send", request, api.toolToken)).status, 403)
  assert.equal((await (await post("/copilot/send", request)).json()).patternSelectionRequired, true)
  assert.equal(sent.length, 0)
  const picker = engine.getSnapshot().bookmapPatternPicker
  const selection = { pickerId: picker.id, positionId: "position-0", patternId: "bid-step-up" }
  assert.equal((await post("/bookmap-pattern/select", selection, api.toolToken)).status, 403)
  assert.equal((await post("/bookmap-pattern/select", selection)).status, 200)
  assert.equal(sent.length, 1)
  assert.match(sent[0][0], /AAA long; positionId: position-0/)
  assert.equal(sent[0][1], request.commandId)
  assert.equal(engine.getSnapshot().tickets.length, 0)
  assert.equal((await post("/bookmap-pattern/select", selection)).status, 400)
  assert.equal(sent.length, 1)
  await post("/copilot/send", { text: "/bookmap-pattern BBB", commandId: "pattern-api-command-002" })
  const manual = engine.getSnapshot().bookmapPatternPicker
  assert.equal((await post("/bookmap-pattern/select", { pickerId: manual.id, positionId: "position-1", patternId: "bid-breakdown" })).status, 200)
  assert.equal(sent.length, 1)
  await post("/copilot/send", { text: "/bookmap-pattern", commandId: "pattern-api-command-003" })
  const cancel = engine.getSnapshot().bookmapPatternPicker
  assert.equal((await post("/bookmap-pattern/cancel", { pickerId: cancel.id })).status, 200)
  assert.equal(engine.getSnapshot().bookmapPatternPicker, null)
})

test("malformed catalog paths and corrupt tag storage fail without overwriting source data", async t => {
  assert.throws(() => parseActivePatterns("## Long\n| bad | Bad | [Bad](../outside.md) |"), /local Markdown/)
  const { patterns, root, source, engine } = await fixture(t)
  patterns.stop()
  await writeFile(patterns.file, "{broken")
  const failed = new BookmapPatterns(engine, root, source)
  await assert.rejects(failed.load(), /could not be read/)
  await assert.rejects(failed.catalog(), /unavailable/)
  assert.equal(await readFile(patterns.file, "utf8"), "{broken")
})
