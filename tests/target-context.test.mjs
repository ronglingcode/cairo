import { aggregate } from './bookmap-aggregate-fixture.mjs'
import test from "node:test"
import assert from "node:assert/strict"
import { targetPositionContext } from "../src/engine/TargetContext.mts"
import { BookmapEvidence } from "../src/engine/BookmapEvidence.mts"
import { CairoDomainTools } from "../src/copilot/CairoDomainTools.mts"
import { positionEngine } from "./fixtures/positions.mjs"

const now = Date.parse("2026-10-05T14:00:10Z")
const iso = t => new Date(t).toISOString()
const ns = t => String(BigInt(t) * 1_000_000n)
function sizing(remaining = 80, side = "long") {
  const snapshot = positionEngine().getSnapshot()
  const position = { ...snapshot.positions[0], quantity: remaining, side }
  snapshot.positions[0] = position
  snapshot.brokerFacts.positions = snapshot.positions
  snapshot.brokerFacts.asOf = iso(now)
  snapshot.attachments = [{ accountId: "fixture", positionId: position.positionId, symbol: "AAA", state: "active",
    tradebookId: "partial", initialQuantity: 100, reviewedAt: iso(now - 10000),
    baseline: { side, quantity: 100, averagePrice: 20, fillIds: ["old"] } }]
  snapshot.brokerFacts.recentFills = remaining === 100 ? [] : [{ fillId: "exit", symbol: "AAA", side: side === "long" ? "sell" : "buy",
    quantity: 100 - remaining, price: 21, filledAt: iso(now - 1000) }]
  return { snapshot, position }
}
test("partials are cumulative against initial shares and retain exact executed prices", () => {
  for (const side of ["long", "short"]) {
    const {snapshot, position} = sizing(80, side)
    snapshot.brokerFacts.recentFills.push(snapshot.brokerFacts.recentFills[0])
    const result = targetPositionContext(snapshot, position, now)
    assert.equal(result.allocationAvailable, true)
    assert.equal(result.partials.quantity, 20)
    assert.equal(result.partials.averagePrice, 21)
    assert.equal(result.earlyPartial.additionalSharesAllowed, 10)
    assert.equal(result.plannedTargets.minimumReservedShares, 70)
  }
})
test("already sold 30% or reached later targets never restarts the early partial", () => {
  for (const remaining of [70, 40]) {
    const {snapshot, position} = sizing(remaining)
    assert.equal(targetPositionContext(snapshot, position, now).earlyPartial.additionalSharesAllowed, 0)
  }
})
test("small-share budgets preserve the rounded-up reserve", () => {
  const {snapshot, position} = sizing(100)
  position.quantity = 3
  snapshot.attachments[0].initialQuantity = snapshot.attachments[0].baseline.quantity = 3
  const result = targetPositionContext(snapshot, position, now)
  assert.equal(result.earlyPartial.additionalSharesAllowed, 0)
  assert.equal(result.plannedTargets.minimumReservedShares, 3)
})
test("adds, missing history, stale facts and absent initial size withhold exact allocation", () => {
  for (const mutate of [
    s => {s.brokerFacts.recentFills = []},
    s => {s.brokerFacts.recentFills.push({fillId:"add", symbol:"AAA", side:"buy", quantity:10, price:20, filledAt:iso(now-500)})},
    s => {s.brokerFacts.asOf = iso(now - 61000)},
    s => {s.attachments = []},
    s => {s.attachments[0].state = "paused"},
  ]) {
    const {snapshot, position} = sizing()
    mutate(snapshot)
    const result = targetPositionContext(snapshot, position, now)
    assert.equal(result.allocationAvailable, false)
    assert.equal(result.earlyPartial.additionalSharesAllowed, null)
  }
})
test("old same-symbol executions never become verified partials or inferred prices", () => {
  const {snapshot, position} = sizing()
  snapshot.brokerFacts.recentFills = [{fillId:"old",symbol:"AAA",side:"sell",quantity:20,price:99,filledAt:iso(now-20000)}]
  const result = targetPositionContext(snapshot, position, now)
  assert.equal(result.netReductionFromInitial, 20)
  assert.equal(result.partials.averagePrice, null)
  assert.equal(result.partials.earlierSameSymbolFills[0].price, 99)
  assert.equal(result.allocationAvailable, false)
})
function liquidity(mode = "live") {
  const evidence = new BookmapEvidence()
  const batch=aggregate(now,{symbol:"AAA",mode,patterns:[],liquidity:{threshold:5000,asOf:ns(now),bestBid:21,bestAsk:21.01,bids:[{price:20,displayedSize:10000},{price:19,displayedSize:10000}],offers:[{price:21.5,displayedSize:10000},{price:22,displayedSize:10000}]}})
  assert.equal(evidence.receive(batch,now), true)
  return {evidence,batch}
}
test("plugin aggregate large levels are consumed in exit direction", () => {
  const {evidence} = liquidity()
  const long = evidence.targetLiquidity("AAA","long",now)
  assert.equal(long.available,true)
  assert.deepEqual(long.levels.map(l=>l.price),[21.5,22])
  assert.equal(long.levels[0].displayedSize,10000)
  assert.equal(long.levels[0].thresholdMultiple,2)
  assert.deepEqual(evidence.targetLiquidity("AAA","short",now).levels.map(l=>l.price),[20,19])
})
test("replay, stale market/receive time, gaps and resets do not establish live liquidity", () => {
  assert.equal(liquidity("replay").evidence.targetLiquidity("AAA","long",now).available,false)
  const {evidence,batch} = liquidity()
  assert.equal(evidence.targetLiquidity("AAA","long",now+11000).available,false)
  evidence.receive({...batch,sequence:2},now+11000)
  assert.equal(evidence.targetLiquidity("AAA","long",now+11000).available,false)
  evidence.receive({...batch,sequence:3,coverage:"gap"},now)
  assert.equal(evidence.targetLiquidity("AAA","long",now).available,false)
  evidence.reset()
  assert.deepEqual(evidence.targetLiquidity("AAA","long",now).levels,[])
})
test("combined tool returns saved targets, computed budget and actual book in one read without writes", async () => {
  const {snapshot,position} = sizing()
  const engine = positionEngine()
  engine.updateSnapshot({...snapshot, preparation:{markdown:"AAA long T1 $22 / T2 $23",tradebookAssignments:[]}})
  const tools = new CairoDomainTools(engine,async()=>true,()=>now)
  tools.setBookmapPatterns({read:async()=>({position,confirmed:true})})
  tools.setBookmapEvidence(liquidity().evidence)
  tools.setAtrTargets((symbol,side) => ({available:true,symbol,side,atr:10,lowOfDay:100,levels:[{multiple:0.5,price:105},{multiple:0.8,price:108}]}))
  const result = await tools.execute("read_target_context",{positionId:position.positionId},"session")
  assert.equal(result.bookmapPattern.confirmed,true)
  assert.deepEqual(result.atrTargets.levels,[{multiple:0.5,price:105},{multiple:0.8,price:108}])
  assert.equal(result.sizing.earlyPartial.additionalSharesAllowed,10)
  assert.equal(result.liquidity.levels[0].price,21.5)
  assert.match(result.preparation.markdown,/T1/)
  assert.equal(result.advisory,true)
  assert.equal(engine.getSnapshot().tickets.length,0)
  await assert.rejects(tools.execute("read_target_context",{positionId:position.positionId,quantity:10},"session"),/Unexpected/)
  await assert.rejects(tools.execute("read_target_context",{positionId:position.positionId},""),/session/)
})
