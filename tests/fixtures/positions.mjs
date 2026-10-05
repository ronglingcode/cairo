import { CairoEngine } from "../../src/engine/CairoEngine.mts"
import { policyBook } from "./management.mjs"
export function positionEngine() {
  const engine = new CairoEngine()
  const at = new Date().toISOString()
  const source = { source: "broker", state: "connected", updatedAt: at, detail: "fixture" }
  const positions = ["AAA", "BBB"].map((symbol, index) => ({ positionId: `position-${index}`, symbol, side: "long", quantity: 10, averagePrice: 20, markPrice: 21, markUpdatedAt: at }))
  engine.updateSnapshot({ positions, broker: source, brokerFactsRevision: 1, brokerFacts: { accountId: "fixture", asOf: at, positions, workingOrders: [], recentFills: [], ordersComplete: true, source }, tradebooks: [policyBook("partial"), policyBook("whole")] })
  return engine
}
export function attachmentRequest(engine, index = 0, style = "partial") { return { accountId: "fixture", positionId: `position-${index}`, factsRevision: engine.getSnapshot().brokerFactsRevision, tradebookId: style, tradebookRevision: engine.getSnapshot().tradebooks.find(book => book.id === style).revision, initialQuantity: 10, reviewed: true, carryInConfirmed: true } }
