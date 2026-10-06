import test from "node:test"
import assert from "node:assert/strict"
import { CopilotWaker } from "../src/copilot/CopilotWaker.mts"
import { positionEngine } from "./fixtures/positions.mjs"
import { PartialManagement } from "../src/copilot/PartialManagement.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"

test("review API stop and reconnect controls target only the selected automatic session", async t => {
  const engine=positionEngine(), calls=[]
  const makeChat=kind=>({snapshot:{connected:true,busy:false,outcome:null,sessionId:kind},notify:async()=>{},cancel:async()=>{calls.push(`cancel:${kind}`)},connect:async()=>{calls.push(`connect:${kind}`)}})
  const bookmap=makeChat("bookmap"),account=makeChat("account"),management=makeChat("management")
  const waker=new CopilotWaker(engine,bookmap,Date.now,account); waker.setEnabled(true)
  const api=new EngineApiServer(engine);api.setCopilotWaker(waker);api.setCopilotAutomaticChat(bookmap);api.setCopilotAccountChat(account);api.setCopilotManagementChat(management)
  const base=await api.start();t.after(()=>api.stop())
  const post=(route,token=api.commandToken)=>fetch(`${base}/copilot/${route}`,{method:"POST",headers:{Authorization:`Bearer ${token}`}})
  assert.equal((await post("account/cancel",api.toolToken)).status,403)
  assert.deepEqual(calls,[])
  assert.equal((await post("account/cancel")).status,200)
  assert.deepEqual(calls,["cancel:account"])
  assert.equal(engine.getSnapshot().copilotWake.enabled,false)
  assert.equal(engine.getSnapshot().copilotWake.bookmapEnabled,true)
  assert.equal(engine.getSnapshot().copilotPartialManagement.enabled,true)
  await post("automatic/connect");await post("account/connect");await post("management/connect")
  assert.deepEqual(calls,["cancel:account","connect:bookmap","connect:account","connect:management"])
})

test("Bookmap, account and management deliver independently; busy, cancel and failure stay in their own review", async () => {
  const engine=positionEngine(); let now=Date.parse(engine.getSnapshot().brokerFacts.asOf)
  const inputs={bookmap:[],account:[],management:[]}
  const makeChat=kind=>({snapshot:{connected:true,busy:false,outcome:null,messages:[]},notify:async text=>{inputs[kind].push(text)},sendAutomatic:async text=>{inputs[kind].push(text)}})
  const bookmap=makeChat("bookmap"), account=makeChat("account"), management=makeChat("management")
  const waker=new CopilotWaker(engine,bookmap,()=>now,account)
  const partial=new PartialManagement(engine,management,async()=>"/manage-trade AAA long",()=>{},()=>now)
  waker.setEnabled(true)
  const change=(quantity, revision)=>{
    now+=1000
    const facts=engine.getSnapshot().brokerFacts; facts.asOf=new Date(now).toISOString(); facts.positions[0].quantity=quantity
    if(quantity===7) facts.recentFills=[{fillId:"partial",orderId:"exit",symbol:"AAA",side:"sell",quantity:3,price:21,filledAt:new Date(now-1).toISOString()}]
    engine.updateSnapshot({brokerFacts:facts,bookmapEvidence:{...engine.getSnapshot().bookmapEvidence,symbols:{AAA:{receivedAt:new Date(now).toISOString(),readiness:"ready",mode:"live",setups:[{id:"setup",revision,symbol:"AAA",patternId:"bid-step-up",state:"candidate"}],observations:[]}}}})
    partial.cycle(); waker.cycle()
  }
  bookmap.snapshot.busy=true
  change(7,1)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(inputs.bookmap.length,0)
  assert.equal(inputs.account.length,1)
  assert.equal(inputs.management.length,1,"partial advice starts while Bookmap remains busy")
  bookmap.snapshot.busy=false
  waker.cycle(); await new Promise(resolve=>setImmediate(resolve))
  assert.equal(inputs.bookmap.length,1,"Bookmap request was not overwritten by account changes")
  bookmap.snapshot.outcome="interrupted"; waker.cycle()
  assert.equal(engine.getSnapshot().copilotWake.bookmapEnabled,false)
  assert.equal(engine.getSnapshot().copilotWake.enabled,true)
  assert.equal(engine.getSnapshot().copilotPartialManagement.enabled,true)
  bookmap.snapshot.outcome=null; waker.setBookmapEnabled(true)
  account.notify=async()=>{throw Error("account failed")}
  now+=15000; change(6,2); await new Promise(resolve=>setImmediate(resolve))
  assert.equal(engine.getSnapshot().copilotWake.enabled,false)
  assert.equal(engine.getSnapshot().copilotWake.bookmapEnabled,true)
  assert.equal(inputs.bookmap.length,2)
  assert.equal(inputs.management.length,1)
})
test("meaningful changes coalesce, repeated polls do not wake, cancel/failure pauses", async () => {
  const engine = positionEngine(); let now = Date.now(); const inputs = []
  const chat = { snapshot: { connected: true, busy: false, outcome: null }, notify: async text => inputs.push(text) }
  const waker = new CopilotWaker(engine, chat, () => now); waker.setEnabled(true)
  const change = quantity => { const facts = engine.getSnapshot().brokerFacts; facts.positions[0].quantity = quantity; facts.asOf = new Date(now).toISOString(); engine.updateSnapshot({ brokerFacts: facts }); waker.cycle() }
  change(9); await new Promise(resolve => setImmediate(resolve)); assert.equal(inputs.length, 1)
  for (let i = 0; i < 100; i++) waker.cycle(); assert.equal(inputs.length, 1)
  chat.snapshot.busy = true; change(8); change(7); now += 15_000; waker.cycle(); assert.equal(inputs.length, 1)
  chat.snapshot.busy = false; waker.cycle(); await new Promise(resolve => setImmediate(resolve)); assert.equal(inputs.length, 2); assert.match(inputs[1], /"quantity":7/)
  chat.snapshot.outcome = "interrupted"; change(6); assert.equal(engine.getSnapshot().copilotWake.enabled, false)
  chat.snapshot.outcome = null; chat.notify = async () => { throw new Error("uncertain") }; waker.setEnabled(true); now += 15_000; change(5)
  await new Promise(resolve => setImmediate(resolve)); assert.equal(engine.getSnapshot().copilotWake.enabled, false); assert.equal(engine.getSnapshot().tickets.length, 0)
})
