import type { CairoEngine } from "./CairoEngine.mts"
import type { HttpPort } from "../shared/contracts.mts"
import type { BookmapTokenProvider } from "./BookmapTokenProvider.mts"
import { ExitTickets, exitFactsFingerprint } from "./ExitTickets.mts"
import { RecoveryStore, type BrokerAttempt } from "./RecoveryStore.mts"
import type { ManagementMonitor } from "./ManagementMonitor.mts"
import { validateExit } from "./ExitEligibility.mts"
export interface ExitWriterOptions {
  engine: CairoEngine; tickets: ExitTickets; recovery: RecoveryStore; monitor: ManagementMonitor; http: HttpPort
  tokens: Pick<BookmapTokenProvider, "readForSelectedAccount" | "invalidate">; refresh(): Promise<void>
}
export class ExitWriter {
  private options: ExitWriterOptions
  private queues = new Map<string, Promise<unknown>>()
  private commands = new Map<string, Promise<BrokerAttempt>>()
  private stopping = false
  async stop(): Promise<void> { this.stopping = true; await Promise.allSettled([...this.queues.values()]) }
  constructor(options: ExitWriterOptions) { this.options = options; this.publish() }
  submit(id: string, hash: string): Promise<BrokerAttempt> {
    if (this.stopping) return Promise.reject(new Error("Broker writer is shutting down"))
    const existing = this.options.recovery.snapshot.attempts.find(item => item.id === id)
    if (existing) return Promise.resolve(existing)
    const command = this.commands.get(id); if (command) return command
    const ticket = this.options.engine.getSnapshot().tickets.find(item => item.id === id)
    if (!ticket) return Promise.reject(new Error("Exact current exit ticket required"))
    const key = `${ticket.accountId}:${ticket.symbol}`
    const task = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => this.send(id, hash))
    this.queues.set(key, task); this.commands.set(id, task)
    void task.finally(() => { if (this.queues.get(key) === task) this.queues.delete(key); if (this.commands.size > 500) this.commands.delete(this.commands.keys().next().value!) }).catch(() => {})
    return task
  }
  reserved(accountId: string, symbol: string): number {
    return this.options.recovery.snapshot.attempts.filter(item => item.ticket.accountId === accountId && item.ticket.symbol === symbol && item.ticket.action !== "cancel-protection" && !["filled", "rejected", "canceled"].includes(item.state)).reduce((sum, item) => sum + Math.max(0, item.ticket.quantity - item.filledQuantity), 0)
  }
  private async send(id: string, hash: string): Promise<BrokerAttempt> {
    const o = this.options
    if (!o.recovery.available) throw new Error("Recovery checkpoint unavailable; writes blocked")
    await o.refresh()
    const authorization = await o.tokens.readForSelectedAccount()
    const ticket = o.engine.getSnapshot().tickets.find(item => item.id === id)
    if (!authorization || !ticket || authorization.accountId !== ticket.accountId) throw new Error("Current selected-account authorization required")
    const mapping = await o.http.request("https://api.schwabapi.com/trader/v1/accounts/accountNumbers", { headers: { Authorization: `Bearer ${authorization.accessToken}` } })
    if (mapping.status !== 200 || !Array.isArray(mapping.body)) throw new Error("Current account mapping unavailable; no order sent")
    const matches = mapping.body.filter(item => item && (String(item.accountNumber) === authorization.accountId || String(item.hashValue) === authorization.accountId))
    if (matches.length !== 1 || typeof matches[0].hashValue !== "string" || !matches[0].hashValue) throw new Error("Account mapping missing or ambiguous")
    const freshAuthorization = await o.tokens.readForSelectedAccount()
    if (!freshAuthorization || freshAuthorization.accountId !== ticket.accountId) throw new Error("Authorization changed before send")
    const reservation = this.reserved(ticket.accountId, ticket.symbol)
    if (o.recovery.snapshot.attempts.some(item => item.ticket.accountId === ticket.accountId && item.ticket.symbol === ticket.symbol && ["unknown", "checkpointed"].includes(item.state))) throw new Error("Uncertain prior attempt blocks new actions until reconciliation")
    if (o.recovery.snapshot.attempts.some(item => item.ticket.accountId === ticket.accountId && item.ticket.symbol === ticket.symbol && item.ticket.action !== "close" && !["filled", "rejected", "canceled"].includes(item.state))) throw new Error("Prior protection change awaits broker confirmation")
    const approved = o.tickets.consumeApproval(id, hash, reservation)
    const attempt: BrokerAttempt = { id, ticket: approved.ticket, attemptedAt: new Date().toISOString(), brokerOrderId: approved.ticket.action === "cancel-protection" ? approved.ticket.orderId : null, state: "checkpointed", filledQuantity: 0, detail: "Checkpointed before broker request", accountHash: matches[0].hashValue }
    await o.recovery.checkpoint(attempt, o.engine.getSnapshot().attachments, o.monitor.checkpointState())
    this.publish()
    let sent = false
    try {
      const snapshot = o.engine.getSnapshot()
      if (!snapshot.tickets.some(item => item.id === id && item.state === "approved" && item.reviewHash === hash)) throw new Error("Approval canceled before send")
      if (exitFactsFingerprint(snapshot) !== approved.ticket.factsFingerprint || Date.parse(approved.ticket.expiresAt) <= Date.now()) throw new Error("Facts changed during checkpoint; no order sent")
      validateExit(snapshot, { ...approved.intent, factsRevision: snapshot.brokerFactsRevision }, approved.origin, Date.now(), reservation)
      sent = true
      const action = approved.ticket.action
      const suffix = action === "close" ? "" : `/${encodeURIComponent(approved.ticket.orderId!)}`
      const result = await o.http.request(`https://api.schwabapi.com/trader/v1/accounts/${encodeURIComponent(attempt.accountHash!)}/orders${suffix}`, { method: action === "close" ? "POST" : action === "cancel-protection" ? "DELETE" : "PUT", headers: { Authorization: `Bearer ${freshAuthorization.accessToken}`, "Content-Type": "application/json" }, ...(action === "cancel-protection" ? {} : { body: JSON.stringify(approved.ticket.exactPayload) }) })
      const location = result.headers?.location
      const brokerOrderId = action === "cancel-protection" ? approved.ticket.orderId : location && /\/orders\/([0-9]+)\/?$/.exec(location)?.[1] || null
      // After an attempted write, errors may follow acceptance. Only explicit broker rejection is terminal.
      const rejection = [400, 422].includes(result.status) && result.body && typeof result.body === "object" && (result.body as Record<string, unknown>).error
      const state = (action === "cancel-protection" ? result.status === 200 || result.status === 204 : result.status === 201) && brokerOrderId ? "accepted" : rejection ? "rejected" : "unknown"
      if (result.status === 401 || result.status === 403) o.tokens.invalidate()
      await o.recovery.updateAttempt(id, { state, brokerOrderId, detail: state === "accepted" ? "Broker acknowledged; waiting for working/fill facts" : state === "rejected" ? "Broker explicitly rejected request" : "Attempted write outcome uncertain; never resend" })
      if (state === "accepted" && approved.ticket.recommendationId) o.monitor.bindSubmittedOrder(approved.ticket.recommendationId, brokerOrderId!)
    } catch {
      await o.recovery.updateAttempt(id, { state: sent ? "unknown" : "rejected", detail: sent ? "Attempted write outcome uncertain; never resend" : "Pre-send facts changed; request not sent" })
    }
    this.publish(); await o.refresh().catch(() => {}); this.reconcileKnown()
    return o.recovery.snapshot.attempts.find(item => item.id === id)!
  }
  reconcileKnown(): void {
    const o = this.options; const snapshot = o.engine.getSnapshot(); const facts = snapshot.brokerFacts
    if (!facts || snapshot.broker.state !== "connected" || Date.now() - Date.parse(facts.asOf) > 60_000) return
    for (const attempt of o.recovery.snapshot.attempts) {
      if (!attempt.brokerOrderId || attempt.ticket.accountId !== facts.accountId || ["filled", "rejected", "canceled"].includes(attempt.state)) continue
      const order = facts.workingOrders.find(item => item.orderId === attempt.brokerOrderId && item.symbol === attempt.ticket.symbol)
      if (attempt.ticket.action === "cancel-protection") {
        const state = order?.status === "canceled" || order?.status === "expired" ? "canceled" : order?.status === "filled" ? "filled" : order?.status === "rejected" ? "rejected" : attempt.state
        if (state !== attempt.state) void o.recovery.updateAttempt(attempt.id, { state, detail: state === "filled" ? "Protection filled before cancellation completed; review the holding" : `Cancellation broker facts: ${state}` }).then(() => this.publish()).catch(() => this.publish("Recovery update failed"))
        continue
      }
      const fills = new Map(facts.recentFills.filter(item => item.orderId === attempt.brokerOrderId && item.symbol === attempt.ticket.symbol && item.side === (attempt.ticket.positionSide === "long" ? "sell" : "buy") && Date.parse(item.filledAt) >= Date.parse(attempt.attemptedAt) && Date.parse(item.filledAt) <= Date.now()).map(item => [item.fillId, item]))
      const filledQuantity = Math.min(attempt.ticket.quantity, [...fills.values()].reduce((sum, item) => sum + item.quantity, 0))
      const state = filledQuantity >= attempt.ticket.quantity ? "filled" : filledQuantity > 0 ? "partial" : order?.status === "rejected" ? "rejected" : order?.status === "canceled" || order?.status === "expired" ? "canceled" : order?.status === "working" ? "working" : attempt.state
      if (state !== attempt.state || filledQuantity !== attempt.filledQuantity) void o.recovery.updateAttempt(attempt.id, { state, filledQuantity, detail: `Broker facts: ${state}` }).then(() => this.publish()).catch(() => this.publish("Recovery update failed; unresolved reservations retained"))
    }
  }
  private publish(error: string | null = null): void { const facts = this.options.engine.getSnapshot().brokerFacts; this.options.engine.updateSnapshot({ brokerAttempts: this.options.recovery.snapshot.attempts, recoveryError: error, executionReady: this.options.recovery.available && Boolean(facts?.ordersComplete) }) }
}
