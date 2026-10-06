import test from "node:test"
import assert from "node:assert/strict"
import { PartialManagement } from "../src/copilot/PartialManagement.mts"
import { positionEngine } from "./fixtures/positions.mjs"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { ManagementContextRequired } from "../src/engine/BookmapPatterns.mts"

const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture(side = "long") {
  const engine = positionEngine()
  let now = Date.parse(engine.getSnapshot().brokerFacts.asOf)
  const facts = engine.getSnapshot().brokerFacts
  facts.positions[0].side = side
  engine.updateSnapshot({ brokerFacts: facts })
  const sent = [], alerts = [], canceled = []
  const chat = { snapshot: { connected: true, busy: false, outcome: null, messages: [] }, cancel: async () => { canceled.push(true); chat.snapshot.busy = false; chat.snapshot.outcome = "interrupted" }, sendAutomatic: async (text, id) => { sent.push({ text, id }); chat.snapshot.busy = true; chat.snapshot.outcome = null } }
  const manager = new PartialManagement(engine, chat, async id => `/manage-trade\n${id}`, symbol => alerts.push(symbol), () => now)
  function poll(quantity, newFills = [], options = {}) {
    now += 1000
    const next = engine.getSnapshot().brokerFacts
    next.asOf = new Date(now).toISOString()
    next.positions[0].quantity = quantity
    next.recentFills.push(...newFills.map(fill => ({ orderId: "exit", symbol: "AAA", price: 21, side: side === "long" ? "sell" : "buy", filledAt: new Date(now - 1).toISOString(), ...fill })))
    Object.assign(next, options)
    engine.updateSnapshot({ brokerFacts: next })
    manager.cycle()
  }
  function finish(text = "1. stop loss: low of day\n2. targets: 0.5 ATR, 0.8 ATR") {
    chat.snapshot.messages.push({ id: `answer-${sent.length}`, role: "assistant", text, tools: [] })
    chat.snapshot.busy = false
    chat.snapshot.outcome = "succeeded"
    manager.cycle()
  }
  return { engine, manager, chat, sent, alerts, canceled, poll, finish }
}

for (const side of ["long", "short"]) test(`30% ${side} partial invokes management once and alerts only after completion`, async () => {
  const f = fixture(side)
  f.poll(9, [{ fillId: "first", quantity: 1 }]); await flush()
  assert.equal(f.sent.length, 0)
  f.poll(7, [{ fillId: "second", quantity: 2 }, { fillId: "second", quantity: 2 }]); await flush()
  assert.equal(f.sent.length, 1)
  assert.match(f.sent[0].text, /\/manage-trade\nposition-0/)
  assert.equal(f.manager.ownsAutomaticChat, true)
  assert.deepEqual(f.alerts, [])
  f.chat.snapshot.messages.push({ id: "streaming", role: "assistant", text: "1. stop loss:", tools: [] })
  f.manager.cycle(); assert.deepEqual(f.alerts, [])
  f.finish(); assert.deepEqual(f.alerts, ["AAA"])
  for (let i = 0; i < 20; i++) f.manager.cycle()
  f.poll(5, [{ fillId: "third", quantity: 2 }]); await flush()
  assert.equal(f.sent.length, 1)
  assert.deepEqual(f.alerts, ["AAA"])
  assert.equal(f.engine.getSnapshot().tickets.length, 0)
})

test("quantity changes alone and stale facts cannot trigger; late fills reconcile", async () => {
  const f = fixture()
  f.poll(7); await flush(); assert.equal(f.sent.length, 0)
  f.poll(7, [{ fillId: "late", quantity: 3 }], { source: { source: "broker", state: "stale", updatedAt: null, detail: null } })
  await flush(); assert.equal(f.sent.length, 0)
  f.poll(7, [], { source: { source: "broker", state: "connected", updatedAt: null, detail: null } })
  await flush(); assert.equal(f.sent.length, 1)
})

test("fills arriving before position readback wait; adds increase the size basis", async () => {
  const f = fixture()
  f.poll(10, [{ fillId: "partial", quantity: 3 }]); await flush(); assert.equal(f.sent.length, 0)
  f.poll(17, [{ fillId: "add", quantity: 10, side: "buy" }]); await flush(); assert.equal(f.sent.length, 0)
  f.poll(14, [{ fillId: "more", quantity: 3 }]); await flush(); assert.equal(f.sent.length, 1)
})

test("management queues only behind another management reply and preserves multiple trades", async () => {
  const f = fixture()
  f.chat.snapshot.busy = true
  f.poll(7, [{ fillId: "a", quantity: 3 }])
  const facts = f.engine.getSnapshot().brokerFacts
  facts.positions[1].quantity = 7
  facts.recentFills.push({ fillId: "b", symbol: "BBB", orderId: "b", side: "sell", quantity: 3, price: 21, filledAt: facts.asOf })
  f.engine.updateSnapshot({ brokerFacts: facts }); f.manager.cycle()
  assert.equal(f.engine.getSnapshot().copilotPartialManagement.pending, 2)
  assert.equal(f.sent.length, 0)
  f.chat.snapshot.busy = false; f.manager.cycle(); await flush()
  assert.equal(f.sent.length, 1)
  f.finish(); await flush(); assert.equal(f.sent.length, 2)
  assert.match(f.sent[1].text, /position-1/)
  f.finish(); assert.deepEqual(f.alerts, ["AAA", "BBB"])
  assert.equal(f.canceled.length, 0, "management never cancels another review")
  const g = fixture(); g.chat.snapshot.busy = true
  g.poll(7, [{ fillId: "c", quantity: 3 }]); g.poll(0)
  g.chat.snapshot.busy = false; g.manager.cycle(); await flush()
  assert.equal(g.sent.length, 0)
})

test("flat/reopen and account changes establish a new baseline without counting historical fills", async () => {
  const f = fixture()
  f.poll(7, [{ fillId: "first", quantity: 3 }]); await flush(); f.finish()
  f.poll(0); f.poll(10)
  f.poll(7, [{ fillId: "new-trade", quantity: 3 }]); await flush(); f.finish()
  assert.equal(f.sent.length, 2)
  f.poll(7, [], { accountId: "another-account" }); await flush()
  assert.equal(f.sent.length, 2)
})

test("failure and cancellation do not sound a ready alert or replay the request", async () => {
  const f = fixture()
  f.chat.sendAutomatic = async () => { throw new Error("delivery uncertain") }
  f.poll(7, [{ fillId: "partial", quantity: 3 }]); await flush()
  assert.match(f.engine.getSnapshot().copilotPartialManagement.error, /delivery uncertain/)
  for (let i = 0; i < 20; i++) f.manager.cycle()
  assert.deepEqual(f.alerts, [])
  const g = fixture()
  g.poll(7, [{ fillId: "partial", quantity: 3 }]); await flush()
  g.chat.snapshot.busy = false; g.chat.snapshot.outcome = "interrupted"; g.manager.cycle()
  assert.equal(g.engine.getSnapshot().copilotPartialManagement.enabled, false)
  assert.deepEqual(g.alerts, [])
})

test("a trade closed during a reply does not sound a ready reminder", async () => {
  const f = fixture()
  f.poll(7, [{ fillId: "partial", quantity: 3 }]); await flush()
  f.poll(0); f.finish()
  assert.deepEqual(f.alerts, [])
})

test("missing pattern produces an immediate actionable notice and context alert without a model request", async () => {
  const engine=positionEngine();let now=Date.parse(engine.getSnapshot().brokerFacts.asOf);const sent=[],alerts=[]
  const manager=new PartialManagement(engine,{snapshot:{connected:true,busy:false,outcome:null,messages:[]},sendAutomatic:async text=>sent.push(text)},async()=>{throw new ManagementContextRequired("AAA: Reconfirm the Bookmap pattern with /bookmap-pattern AAA, then run /manage-trade AAA.")},(...args)=>alerts.push(args),()=>now)
  now+=1000
  const facts=engine.getSnapshot().brokerFacts;facts.asOf=new Date(now).toISOString();facts.positions[0].quantity=7;facts.recentFills=[{fillId:"partial",orderId:"exit",symbol:"AAA",side:"sell",quantity:3,price:21,filledAt:new Date(now-1).toISOString()}]
  engine.updateSnapshot({brokerFacts:facts});manager.cycle();await flush()
  assert.deepEqual(sent,[])
  assert.match(engine.getSnapshot().copilotPartialManagement.notice.text,/\/bookmap-pattern AAA/)
  assert.equal(engine.getSnapshot().copilotPartialManagement.error,null)
  assert.deepEqual(alerts,[["AAA",true]])
  manager.cycle();assert.equal(alerts.length,1)
})

test("a waiting pattern cannot resume a stopped or closed trade", async () => {
  for(const mode of ["stop","close"]) {
    const engine=positionEngine();let now=Date.parse(engine.getSnapshot().brokerFacts.asOf),confirmed=false;const sent=[]
    const manager=new PartialManagement(engine,{snapshot:{connected:true,busy:false,outcome:null,messages:[]},sendAutomatic:async text=>sent.push(text)},async()=>{if(!confirmed)throw new ManagementContextRequired("Tag pattern first");return "/manage-trade AAA"},()=>{},()=>now)
    now+=1000;const facts=engine.getSnapshot().brokerFacts;facts.asOf=new Date(now).toISOString();facts.positions[0].quantity=7;facts.recentFills=[{fillId:"partial",orderId:"exit",symbol:"AAA",side:"sell",quantity:3,price:21,filledAt:new Date(now-1).toISOString()}]
    engine.updateSnapshot({brokerFacts:facts});manager.cycle();await flush()
    assert.deepEqual(engine.getSnapshot().copilotPartialManagement.waitingForPattern,["AAA"])
    if(mode==="stop")manager.setEnabled(false)
    else {facts.positions[0].quantity=0;engine.updateSnapshot({brokerFacts:facts});manager.cycle()}
    confirmed=true
    engine.updateSnapshot({bookmapPatternTags:[{accountId:"fixture",positionId:"position-0",side:"long",revision:"new",active:true,runtimeInstanceId:engine.runtimeInstanceId}]})
    manager.cycle();await flush()
    assert.deepEqual(sent,[])
    assert.deepEqual(engine.getSnapshot().copilotPartialManagement.waitingForPattern,[])
    await assert.rejects(manager.requestPattern("position-0"),/no longer waiting/)
  }
})

test("reminder controls require the trader token and only Stop management pauses partial reminders", async t => {
  const f = fixture()
  const api = new EngineApiServer(f.engine); api.setPartialManagement(f.manager)
  api.setCopilotAutomaticChat({ snapshot: { sessionId: "automatic" }, cancel: async () => {} })
  api.setCopilotManagementChat({ snapshot: { sessionId: "management" }, cancel: async () => {} })
  const base = await api.start(); t.after(() => api.stop())
  const post = (route, body, token = api.commandToken) => fetch(`${base}${route}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
  assert.equal((await post("/copilot/partial-management", { enabled: false }, api.toolToken)).status, 403)
  assert.equal((await post("/copilot/partial-management", { enabled: "false" })).status, 400)
  assert.equal((await post("/copilot/partial-management", { enabled: false })).status, 200)
  assert.equal(f.engine.getSnapshot().copilotPartialManagement.enabled, false)
  await post("/copilot/partial-management", { enabled: true })
  assert.equal((await post("/copilot/automatic/cancel", {})).status, 200)
  assert.equal(f.engine.getSnapshot().copilotPartialManagement.enabled, true)
  assert.equal((await post("/copilot/management/cancel", {})).status, 200)
  assert.equal(f.engine.getSnapshot().copilotPartialManagement.enabled, false)
})
