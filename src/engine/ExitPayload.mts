import type { BrokerPosition, ExitOrderShape } from "../shared/contracts.mts"
export interface EquityExitPayload {
  orderType: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT"; session: "NORMAL"; duration: "DAY"; orderStrategyType: "SINGLE"
  price?: string; stopPrice?: string
  orderLegCollection: Array<{ instruction: "SELL" | "BUY_TO_COVER"; quantity: number; instrument: { symbol: string; assetType: "EQUITY" } }>
}
/** Pure payload builder. It cannot place orders or construct entries. Sub-cent prices require clarification. */
export function buildExitPayload(position: BrokerPosition, request: ExitOrderShape, session: string = "NORMAL"): EquityExitPayload {
  if (!position || !["long", "short"].includes(position.side) || !/^[A-Z][A-Z0-9.-]{0,15}$/.test(position.symbol) || !Number.isSafeInteger(position.quantity) || position.quantity <= 0) throw new Error("Supported whole-share equity holding required")
  if (!request || Object.keys(request).some(key => !["orderType", "quantity", "limitPrice", "stopPrice", "duration"].includes(key)) || !Number.isSafeInteger(request.quantity) || request.quantity <= 0 || request.quantity > position.quantity) throw new Error("Exit quantity must be whole shares within the current holding")
  if (session !== "NORMAL" || request.duration !== "DAY") throw new Error("Only regular-session DAY exits are supported")
  const types = { market: "MARKET", limit: "LIMIT", stop: "STOP", "stop-limit": "STOP_LIMIT" } as const
  if (!(request.orderType in types)) throw new Error("Unsupported equity exit order type")
  const needsLimit = request.orderType === "limit" || request.orderType === "stop-limit"
  const needsStop = request.orderType === "stop" || request.orderType === "stop-limit"
  if (needsLimit !== (request.limitPrice !== null) || needsStop !== (request.stopPrice !== null)) throw new Error("Exact prices must match the selected order type")
  return { orderType: types[request.orderType], session: "NORMAL", duration: "DAY", orderStrategyType: "SINGLE",
    ...(needsLimit ? { price: cents(request.limitPrice!) } : {}), ...(needsStop ? { stopPrice: cents(request.stopPrice!) } : {}),
    orderLegCollection: [{ instruction: position.side === "long" ? "SELL" : "BUY_TO_COVER", quantity: request.quantity, instrument: { symbol: position.symbol, assetType: "EQUITY" } }] }
}
function cents(value: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.01 || value > 1_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) throw new Error("Price must be finite positive USD in whole cents; clarify sub-cent prices")
  return (Math.round(value * 100) / 100).toFixed(2)
}
