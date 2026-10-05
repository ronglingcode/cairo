import test from "node:test"
import assert from "node:assert/strict"
import { validateExit } from "../src/engine/ExitEligibility.mts"
import { positionEngine, attachmentRequest } from "./fixtures/positions.mjs"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"
export function exitIntent() { return { intent: "close", accountId: "fixture", positionId: "position-0", symbol: "AAA", positionSide: "long", factsRevision: 1, quantity: 5, orderType: "market", reason: "Explicit reviewed exit", commandId: "request-001" } }
test("explicit exits use broker holdings even with stale chart; invalid/bypass attempts reject", () => {
  const engine = positionEngine(); const snapshot = engine.getSnapshot(); const input = exitIntent()
  assert.equal(validateExit(snapshot, input, "trader").payload.orderLegCollection[0].instruction, "SELL")
  for (const change of [{ accountId: "wrong" }, { symbol: "BBB" }, { positionSide: "short" }, { quantity: 11 }, { quantity: 0 }, { intent: "open" }, { approved: true }]) assert.throws(() => validateExit(snapshot, { ...input, ...change }, "trader"))
  assert.throws(() => validateExit(snapshot, input, "copilot"), /evidenced/)
  assert.throws(() => validateExit(snapshot, input, "trader", Date.now() + 61_000), /Fresh/)
  assert.throws(() => validateExit({ ...snapshot, brokerFacts: { ...snapshot.brokerFacts, ordersComplete: false } }, input, "trader"))
  assert.throws(() => validateExit(snapshot, input, "trader", Date.now(), 6), /available/)
})
test("rule exits need current scoped confirmation, quantity and exact interpreted payload", () => {
  const engine = positionEngine(); const guidance = new PositionGuidance(engine); const monitor = new ManagementMonitor(engine, guidance)
  const attachment = guidance.attach(attachmentRequest(engine)); monitor.confirm(attachment.id, attachment.revision, 1, "trigger", true)
  const input = { ...exitIntent(), recommendationId: engine.getSnapshot().recommendations[0].id }
  assert.equal(validateExit(engine.getSnapshot(), input, "copilot").sourceClauseId, "clause")
  assert.throws(() => validateExit(engine.getSnapshot(), { ...input, orderType: "limit", limitPrice: 22 }, "copilot"), /differs/)
  const facts = engine.getSnapshot().brokerFacts; facts.positions[0].quantity = 3; engine.updateSnapshot({ brokerFacts: facts, brokerFactsRevision: 2 })
  assert.throws(() => validateExit(engine.getSnapshot(), input, "copilot"))
})
test("only exact standalone current closing protection qualifies; OCO and entries stay manual", () => {
  const engine = positionEngine(); const snapshot = engine.getSnapshot(); const order = { orderId: "stop", symbol: "AAA", side: "sell", quantity: 10, filledQuantity: 0, status: "working", orderType: "STOP", parentOrderId: null, ocoGroupId: null, positionEffect: "CLOSING", instruction: "SELL", session: "NORMAL", duration: "DAY", strategy: "SINGLE", legCount: 1 }
  snapshot.brokerFacts.workingOrders = [order]
  assert.throws(() => validateExit(snapshot, exitIntent(), "trader"), /working orders/)
  const cancel = { ...exitIntent(), intent: "cancel-protection", orderId: "stop", quantity: 10 }; delete cancel.orderType
  assert.equal(validateExit(snapshot, cancel, "trader").affectedOrders[0].orderId, "stop")
  for (const change of [{ ocoGroupId: "oco" }, { positionEffect: "OPENING" }, { session: "SEAMLESS" }, { legCount: 2 }, { status: "cancel-pending" }]) { snapshot.brokerFacts.workingOrders = [{ ...order, ...change }]; assert.throws(() => validateExit(snapshot, cancel, "trader"), /Unsupported/) }
})
