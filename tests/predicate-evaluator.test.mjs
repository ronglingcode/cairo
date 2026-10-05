import test from "node:test"
import assert from "node:assert/strict"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { evaluatePredicate, validatePredicate } from "../src/engine/PredicateEvaluator.mts"

const now = Date.parse("2026-10-04T16:00:00Z")
const at = new Date(now).toISOString()
const scope = { accountId: "account", positionId: "position", symbol: "SPY", attachmentId: "attachment", interpretationRevision: "revision" }
const quantity = { kind: "compare", field: "position.quantity", operator: "gte", value: 5 }
const human = { kind: "human", conditionId: "weakness" }
const fill = { kind: "broker-fill", orderId: "exit", side: "sell", minimumQuantity: 3, since: new Date(now - 60_000).toISOString() }
function context() {
  const engine = new CairoEngine()
  const source = { source: "broker", state: "connected", updatedAt: at, detail: "fixture" }
  const position = { positionId: "position", symbol: "SPY", side: "long", quantity: 7, averagePrice: 500, markPrice: 501, markUpdatedAt: at }
  engine.updateSnapshot({ broker: source, brokerFactsRevision: 2, positions: [position], brokerFacts: { accountId: "account", asOf: at, positions: [position], workingOrders: [], recentFills: [], ordersComplete: true, source },
    chart: { symbol: "SPY", interval: "1m", fetchedAt: at, latestBarAt: new Date(now - 60_000).toISOString(), bars: [{ time: now - 60_000, open: 500, high: 502, low: 499, close: 501, volume: 1000 }], source: { source: "chart", state: "stale", updatedAt: at, detail: "prior snapshot" } },
  })
  return { snapshot: engine.getSnapshot(), scope: { ...scope }, now, confirmations: [] }
}

test("scalar grammar is pure, finite, strict and bounded", () => {
  const c = context()
  const before = structuredClone(c)
  assert.equal(evaluatePredicate({ kind: "scalar", left: 3, operator: "gt", right: 2 }, c).state, "satisfied")
  assert.equal(evaluatePredicate({ kind: "scalar", left: 3, operator: "lt", right: 2 }, c).state, "pending")
  for (const invalid of [null, { kind: "scalar", left: NaN, operator: "gt", right: 2 }, { kind: "compare", field: "code", operator: "gt", value: 1 }, { ...quantity, script: "return true" }, { kind: "all", conditions: [] }]) assert.equal(evaluatePredicate(invalid, c).state, "invalid")
  let nested = quantity
  for (let index = 0; index < 10; index++) nested = { kind: "all", conditions: [nested] }
  assert.throws(() => validatePredicate(nested), /size/)
  assert.deepEqual(c, before)
})

test("broker scalar conditions require fresh matching account and position facts", () => {
  const c = context()
  assert.equal(evaluatePredicate(quantity, c).actionEligible, true)
  const mark = { kind: "compare", field: "broker.markPrice", operator: "gt", value: 500 }
  assert.equal(evaluatePredicate(mark, c).state, "satisfied")
  c.snapshot.brokerFacts.positions[0].markUpdatedAt = null
  assert.equal(evaluatePredicate(mark, c).state, "unknown")
  c.snapshot.brokerFacts.asOf = new Date(now - 60_001).toISOString()
  assert.equal(evaluatePredicate(quantity, c).state, "unknown")
  c.snapshot.brokerFacts.asOf = new Date(now + 1).toISOString()
  assert.equal(evaluatePredicate(quantity, c).state, "unknown")
  c.snapshot.brokerFacts.asOf = at
  c.scope.accountId = "another-account"
  assert.equal(evaluatePredicate(quantity, c).state, "unknown")
  c.scope.accountId = "account"
  c.scope.positionId = "another-position"
  assert.equal(evaluatePredicate(quantity, c).state, "unknown")
})

test("refreshed REST candles never satisfy a live rule; historical comparison is ineligible", () => {
  const c = context()
  const chart = { kind: "compare", field: "chart.lastClose", operator: "gt", value: 500 }
  for (const state of ["stale", "connected"]) {
    c.snapshot.chart.source.state = state
    c.snapshot.chart.fetchedAt = at
    assert.equal(evaluatePredicate(chart, c).state, "unknown")
    assert.equal(evaluatePredicate(chart, c).actionEligible, false)
  }
  const historical = evaluatePredicate(chart, { ...c, purpose: "historical-context" })
  assert.equal(historical.state, "satisfied")
  assert.equal(historical.actionEligible, false)
  assert.equal(historical.evidence[0].sourceAt, c.snapshot.chart.latestBarAt)
  assert.equal(evaluatePredicate({ kind: "live-price", conditionId: "crossing" }, c).state, "unknown")
  assert.equal(evaluatePredicate({ kind: "bookmap", conditionId: "episode" }, c).state, "unknown")
})

test("small groups preserve unknown coverage and never hide invalid clauses", () => {
  const c = context()
  const unknown = { kind: "live-price", conditionId: "crossing" }
  assert.equal(evaluatePredicate({ kind: "all", conditions: [quantity, unknown] }, c).state, "unknown")
  const any = evaluatePredicate({ kind: "any", conditions: [quantity, unknown] }, c)
  assert.equal(any.state, "satisfied")
  assert.equal(any.evidence.length, 2)
  assert.equal(any.evidence[1].state, "unknown")
  assert.equal(evaluatePredicate({ kind: "any", conditions: [quantity, { kind: "arbitrary" }] }, c).state, "invalid")
})

test("human confirmations bind runtime, position, interpretation, condition and broker revision", () => {
  const c = context()
  const confirmation = { scope: { ...scope }, runtimeInstanceId: c.snapshot.runtimeInstanceId, brokerFactsRevision: 2, conditionId: "weakness", confirmedAt: at, expiresAt: new Date(now + 60_000).toISOString(), value: true }
  assert.equal(evaluatePredicate(human, c).state, "pending")
  c.confirmations = [confirmation]
  assert.equal(evaluatePredicate(human, c).state, "satisfied")
  for (const key of Object.keys(scope)) {
    c.confirmations = [{ ...confirmation, scope: { ...scope, [key]: "different" } }]
    assert.equal(evaluatePredicate(human, c).state, "pending", key)
  }
  for (const [key, value] of [["runtimeInstanceId", "previous"], ["brokerFactsRevision", 1], ["conditionId", "other"], ["expiresAt", at], ["confirmedAt", new Date(now + 1).toISOString()]]) {
    c.confirmations = [{ ...confirmation, [key]: value }]
    assert.equal(evaluatePredicate(human, c).state, "pending", key)
  }
  c.confirmations = [{ ...confirmation, value: false }]
  assert.equal(evaluatePredicate(human, c).state, "pending")
  c.confirmations = [confirmation]
  c.snapshot.broker.state = "stale"
  assert.equal(evaluatePredicate(human, c).state, "unknown")
})

test("actual fill evidence remains usable with stale charts and never counts acceptance or duplicates", () => {
  const c = context()
  c.snapshot.brokerFacts.workingOrders = [{ orderId: "exit", symbol: "SPY", side: "sell", quantity: 3, status: "working" }]
  assert.equal(evaluatePredicate(fill, c).state, "pending")
  const actual = { fillId: "fill", orderId: "exit", symbol: "SPY", side: "sell", quantity: 3, price: 501, filledAt: at }
  c.snapshot.brokerFacts.recentFills = [actual, { ...actual }]
  assert.equal(evaluatePredicate(fill, c).state, "satisfied")
  assert.equal(evaluatePredicate({ ...fill, minimumQuantity: 6 }, c).state, "pending")
  assert.equal(evaluatePredicate(fill, c).actionEligible, true)
  c.snapshot.brokerFacts.recentFills = [actual, { ...actual, quantity: 1 }]
  assert.equal(evaluatePredicate(fill, c).state, "invalid")
  c.snapshot.brokerFacts.recentFills = [{ ...actual, filledAt: new Date(now + 1).toISOString() }]
  assert.equal(evaluatePredicate(fill, c).state, "unknown")
  c.snapshot.brokerFacts.recentFills = [actual]
  assert.equal(evaluatePredicate({ ...fill, orderId: "other" }, c).state, "pending")
  c.snapshot.brokerFacts.ordersComplete = false
  assert.equal(evaluatePredicate({ ...fill, orderId: "other" }, c).state, "unknown")
  assert.equal(evaluatePredicate(fill, c).state, "satisfied")
  c.snapshot.broker.state = "stale"
  assert.equal(evaluatePredicate(fill, c).state, "unknown")
})
