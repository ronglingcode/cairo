import type { CairoEngine } from "./CairoEngine.mts"
import type { BookmapTokenProvider } from "./BookmapTokenProvider.mts"
import type { BrokerWorkingOrder, HttpPort } from "../shared/contracts.mts"
import { RecoveryStore, type BrokerAttempt } from "./RecoveryStore.mts"
import { normalizeSingleSchwabOrder } from "./SchwabOrderReader.mts"
export class UnknownReconciler {
  private engine: CairoEngine; private recovery: RecoveryStore; private http: HttpPort; private tokens: Pick<BookmapTokenProvider, "readForSelectedAccount">
  private busy = false; private lastRead = -Infinity
  private pendingTask: Promise<void> | undefined; private stopping = false
  tick(): void { if (!this.stopping && !this.pendingTask) this.pendingTask = this.reconcile().finally(() => { this.pendingTask = undefined }) }
  async stop(): Promise<void> { this.stopping = true; await this.pendingTask }
  constructor(engine: CairoEngine, recovery: RecoveryStore, http: HttpPort, tokens: Pick<BookmapTokenProvider, "readForSelectedAccount">) { this.engine = engine; this.recovery = recovery; this.http = http; this.tokens = tokens }
  async reconcile(): Promise<void> {
    if (this.busy || Date.now() - this.lastRead < 15_000 || !this.recovery.available) return
    this.busy = true; this.lastRead = Date.now()
    try {
      const authorization = await this.tokens.readForSelectedAccount(); if (!authorization) return
      const attempts = this.recovery.snapshot.attempts.filter(item => item.ticket.accountId === authorization.accountId && !["filled", "canceled", "rejected"].includes(item.state)).slice(0, 10)
      for (const attempt of attempts) {
        if (!attempt.accountHash) continue
        if (attempt.brokerOrderId) {
          const response = await this.http.request(`https://api.schwabapi.com/trader/v1/accounts/${encodeURIComponent(attempt.accountHash)}/orders/${encodeURIComponent(attempt.brokerOrderId)}`, { headers: { Authorization: `Bearer ${authorization.accessToken}` } })
          if (response.status !== 200) continue // absence/error after a send proves nothing
          const result = normalizeSingleSchwabOrder(response.body)
          const order = result.orders.find(item => item.orderId === attempt.brokerOrderId && matchesOrder(attempt, item))
          if (!result.complete || !order) continue
          const filledQuantity = Math.min(attempt.ticket.quantity, Math.max(attempt.filledQuantity, order.filledQuantity ?? 0))
          const state = order.status === "canceled" || order.status === "expired" ? "canceled" : order.status === "rejected" ? "rejected" : order.status === "filled" && filledQuantity >= attempt.ticket.quantity ? "filled" : attempt.ticket.action === "cancel-protection" ? "accepted" : filledQuantity > 0 ? "partial" : order.status === "working" ? "working" : "unknown"
          await this.recovery.updateAttempt(attempt.id, { state, filledQuantity, detail: `Known broker order read: ${state}` })
        } else {
          const from = new Date(Date.parse(attempt.attemptedAt) - 5000).toISOString(); const to = new Date(Math.min(Date.now(), Date.parse(attempt.attemptedAt) + 60_000)).toISOString()
          const query = new URLSearchParams({ fromEnteredTime: from, toEnteredTime: to, maxResults: "100" })
          const response = await this.http.request(`https://api.schwabapi.com/trader/v1/accounts/${encodeURIComponent(attempt.accountHash)}/orders?${query}`, { headers: { Authorization: `Bearer ${authorization.accessToken}` } })
          if (response.status !== 200 || !Array.isArray(response.body) || response.body.length >= 100) continue
          const candidates = response.body.flatMap(raw => {
            if (!raw || typeof raw !== "object" || !Number.isFinite(Date.parse(raw.enteredTime)) || Math.abs(Date.parse(raw.enteredTime) - Date.parse(attempt.attemptedAt)) > 60_000) return []
            return normalizeSingleSchwabOrder(raw).orders.filter(order => matchesOrder(attempt, order) && !(attempt.ticket.affectedOrders ?? []).some(previous => previous.orderId === order.orderId)).map(order => order.orderId)
          })
          const ids = [...new Set(candidates)]
          await this.recovery.updateAttempt(attempt.id, { state: "unknown", detail: ids.length === 1 ? `Possible matching broker order ${ids[0]}; confirm identity manually. No resend.` : ids.length ? "Multiple matching orders; resolve manually. No resend." : "No matching order visible yet; outcome remains uncertain. No resend." })
        }
      }
      this.engine.updateSnapshot({ brokerAttempts: this.recovery.snapshot.attempts })
    } catch { this.engine.updateSnapshot({ recoveryError: "Uncertainty reconciliation read failed; reservations retained" }) }
    finally { this.busy = false }
  }
  async confirmIdentity(id: string, brokerOrderId: string, reviewed: boolean): Promise<void> {
    if (reviewed !== true || !/^[0-9]+$/.test(brokerOrderId)) throw new Error("Explicit exact broker order identity review required")
    const attempt = this.recovery.snapshot.attempts.find(item => item.id === id && !item.brokerOrderId && ["checkpointed", "unknown"].includes(item.state))
    const authorization = await this.tokens.readForSelectedAccount()
    if (!attempt?.accountHash || !authorization || authorization.accountId !== attempt.ticket.accountId) throw new Error("Current matching account/uncertain attempt required")
    const response = await this.http.request(`https://api.schwabapi.com/trader/v1/accounts/${encodeURIComponent(attempt.accountHash)}/orders/${encodeURIComponent(brokerOrderId)}`, { headers: { Authorization: `Bearer ${authorization.accessToken}` } })
    const raw = response.body as Record<string, unknown> | null
    if (response.status !== 200 || !raw || typeof raw.enteredTime !== "string" || !Number.isFinite(Date.parse(raw.enteredTime)) || Math.abs(Date.parse(raw.enteredTime) - Date.parse(attempt.attemptedAt)) > 60_000 || !normalizeSingleSchwabOrder(raw).orders.some(order => order.orderId === brokerOrderId && matchesOrder(attempt, order))) throw new Error("Broker order differs from exact attempted request/time")
    if (this.recovery.snapshot.attempts.some(item => item.id !== id && item.ticket.accountId === attempt.ticket.accountId && item.brokerOrderId === brokerOrderId)) throw new Error("Broker identity already belongs to another attempt")
    await this.recovery.updateAttempt(id, { brokerOrderId, state: "unknown", detail: "Trader confirmed matching broker identity; awaiting broker reconciliation" })
    this.lastRead = -Infinity; await this.reconcile()
  }
}
function matchesOrder(attempt: BrokerAttempt, order: BrokerWorkingOrder): boolean {
  const ticket = attempt.ticket; const payload = ticket.action === "cancel-protection" ? ticket.affectedOrders?.[0] : ticket.exactPayload
  if (order.symbol !== ticket.symbol || order.instruction !== (ticket.positionSide === "long" ? "SELL" : "BUY_TO_COVER") || order.positionEffect !== "CLOSING" || order.ocoGroupId || order.parentOrderId || order.strategy !== "SINGLE" || order.legCount !== 1) return false
  if (ticket.action === "cancel-protection") return order.orderId === ticket.orderId && order.quantity === ticket.affectedOrders?.[0]?.quantity
  return !!payload && "orderLegCollection" in payload && order.quantity === ticket.quantity && order.orderType === payload.orderType && order.session === payload.session && order.duration === payload.duration && (order.limitPrice ?? null) === (payload.price ? Number(payload.price) : null) && (order.stopPrice ?? null) === (payload.stopPrice ? Number(payload.stopPrice) : null)
}
