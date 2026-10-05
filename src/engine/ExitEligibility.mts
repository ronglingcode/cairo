import type { BrokerPosition, BrokerWorkingOrder, CairoSnapshot, ExitAction, ExitOrderShape } from "../shared/contracts.mts"
import { buildExitPayload, type EquityExitPayload } from "./ExitPayload.mts"
export interface ExitIntent {
  intent: ExitAction; accountId: string; positionId: string; symbol: string; positionSide: "long" | "short"
  factsRevision: number; quantity: number; orderType?: ExitOrderShape["orderType"]; limitPrice?: number | null; stopPrice?: number | null
  orderId?: string; recommendationId?: string; reason: string; commandId: string
}
export interface EligibleExit { position: BrokerPosition; request: ExitOrderShape | null; payload: EquityExitPayload | null; affectedOrders: BrokerWorkingOrder[]; sourceClauseId: string | null; attachmentRevision: string | null }
export function validateExit(snapshot: CairoSnapshot, input: ExitIntent, origin: "trader" | "copilot", now: number = Date.now(), reserved = 0): EligibleExit {
  if (!input || Object.keys(input).some(key => !["intent", "accountId", "positionId", "symbol", "positionSide", "factsRevision", "quantity", "orderType", "limitPrice", "stopPrice", "orderId", "recommendationId", "reason", "commandId"].includes(key))) throw new Error("Unsupported exit fields; tool allowances cannot authorize orders")
  if (!["close", "cancel-protection", "replace-protection"].includes(input.intent)) throw new Error("Opening, increasing and reversing are prohibited")
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 4000 || typeof input.commandId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(input.commandId)) throw new Error("Bounded reason and request identity required")
  const facts = snapshot.brokerFacts; const age = facts ? now - Date.parse(facts.asOf) : Infinity
  const sourceAge = facts?.source.updatedAt ? now - Date.parse(facts.source.updatedAt) : Infinity
  if (!facts || facts.accountId !== input.accountId || snapshot.brokerFactsRevision !== input.factsRevision || snapshot.broker.state !== "connected" || facts.source.state !== "connected" || !Number.isFinite(age) || age < 0 || age > 60_000 || !Number.isFinite(sourceAge) || sourceAge < 0 || sourceAge > 60_000 || !facts.ordersComplete) throw new Error("Fresh complete matching broker facts required")
  const positions = facts.positions.filter(item => item.positionId === input.positionId && item.symbol === input.symbol && item.side === input.positionSide)
  if (positions.length !== 1 || !Number.isSafeInteger(positions[0]!.quantity) || positions[0]!.quantity <= 0) throw new Error("Exact current whole-share holding and side required")
  const position = positions[0]!
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || !Number.isSafeInteger(reserved) || reserved < 0 || input.intent !== "cancel-protection" && input.quantity > position.quantity - reserved) throw new Error("Quantity exceeds currently available whole shares")
  const working = facts.workingOrders.filter(item => item.symbol === position.symbol && !["filled", "canceled", "replaced", "rejected", "expired"].includes(item.status))
  let affectedOrders: BrokerWorkingOrder[] = []
  if (input.intent === "close") {
    if (input.orderId) throw new Error("Close cannot replace or cancel an existing order")
    if (working.length) throw new Error("Resolve working orders/protection before staging another close; combined coverage is unsafe")
  } else {
    const orders = working.filter(order => order.orderId === input.orderId)
    if (orders.length !== 1) throw new Error("Exact current protection order required")
    const order = orders[0]!
    if (!supportedProtection(order, position) || working.some(item => item.orderId !== order.orderId)) throw new Error("Unsupported or ambiguous protection relationship; resolve manually")
    if (input.intent === "cancel-protection" && input.quantity !== order.quantity - (order.filledQuantity ?? 0)) throw new Error("Cancellation quantity must match exact outstanding protection")
    affectedOrders = [structuredClone(order)]
  }
  const request: ExitOrderShape | null = input.intent === "cancel-protection" ? null : { orderType: input.orderType!, quantity: input.quantity, limitPrice: input.limitPrice ?? null, stopPrice: input.stopPrice ?? null, duration: "DAY" }
  const payload = request ? buildExitPayload(position, request) : null
  let sourceClauseId: string | null = null; let attachmentRevision: string | null = null
  if (origin === "copilot" && !input.recommendationId) throw new Error("AI staging requires a current evidenced recommendation; explicit trader exits use the review controls")
  if (input.recommendationId) {
    const recommendation = snapshot.recommendations.find(item => item.id === input.recommendationId && item.state === "current")
    const attachment = recommendation && snapshot.attachments.find(item => item.id === recommendation.attachmentId && item.state === "active" && item.revision === recommendation.attachmentRevision)
    const readback = recommendation && snapshot.management.find(item => item.attachmentId === recommendation.attachmentId && item.ruleId === recommendation.ruleId && item.result.actionEligible)
    if (!recommendation || !attachment || !readback || recommendation.factsRevision !== input.factsRevision || recommendation.accountId !== input.accountId || recommendation.positionId !== input.positionId || recommendation.symbol !== input.symbol || recommendation.quantity !== input.quantity || recommendation.action.kind !== input.intent) throw new Error("Current scoped condition evidence and recommendation required")
    const levels = attachment.interpretation.management!.levels
    const expected = buildExitPayload(position, { orderType: recommendation.action.orderType, quantity: recommendation.quantity, limitPrice: levels.find(item => item.id === recommendation.action.limitLevel)?.value ?? null, stopPrice: levels.find(item => item.id === recommendation.action.stopLevel)?.value ?? null, duration: "DAY" })
    if (JSON.stringify(expected) !== JSON.stringify(payload) || (recommendation.action.orderId ?? undefined) !== input.orderId) throw new Error("Proposed request differs from interpreted action")
    sourceClauseId = recommendation.sourceClauseId; attachmentRevision = attachment.revision!
  }
  return { position: structuredClone(position), request, payload, affectedOrders, sourceClauseId, attachmentRevision }
}
export function supportedProtection(order: BrokerWorkingOrder, position: BrokerPosition): boolean {
  return ["working", "partially-filled"].includes(order.status) && order.positionEffect === "CLOSING" && order.instruction === (position.side === "long" ? "SELL" : "BUY_TO_COVER") && order.side === (position.side === "long" ? "sell" : "buy") && !order.parentOrderId && !order.ocoGroupId && order.strategy === "SINGLE" && order.legCount === 1 && order.session === "NORMAL" && order.duration === "DAY" && ["LIMIT", "STOP", "STOP_LIMIT"].includes(order.orderType) && Number.isSafeInteger(order.quantity) && Number.isSafeInteger(order.filledQuantity ?? 0) && order.quantity > (order.filledQuantity ?? 0)
}
