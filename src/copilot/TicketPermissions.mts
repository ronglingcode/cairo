import type { OpenCodeClient } from "./OpenCodeSidecar.mts"
import type { ExitTickets } from "../engine/ExitTickets.mts"
import type { ExitIntent } from "../engine/ExitEligibility.mts"
export interface ToolSource { messageID: string; id: string; agent: string }
interface Pending { sessionId: string; permissionId: string; hash: string; resolve(value: unknown): void; timer: ReturnType<typeof setTimeout>; deciding?: boolean }
export class TicketPermissions {
  private tickets: ExitTickets; private client: () => OpenCodeClient | undefined; private pending = new Map<string, Pending>()
  constructor(tickets: ExitTickets, client: () => OpenCodeClient | undefined) { this.tickets = tickets; this.client = client }
  has(id: string): boolean { return this.pending.has(id) }
  async stage(input: ExitIntent, sessionId: string, source: ToolSource): Promise<unknown> {
    if (!source || typeof source.messageID !== "string" || !source.messageID.startsWith("msg_") || typeof source.id !== "string" || !source.id || typeof source.agent !== "string" || source.agent.length > 100 || this.pending.size >= 20) throw new Error("Bounded current tool-call identity required")
    const ticket = this.tickets.stage(input, "copilot"); const client = this.client()
    if (!client || this.pending.has(ticket.id)) throw new Error("Runtime unavailable or this exact ticket is already awaiting review")
    const permission = await client.permission.create({ sessionID: sessionId, action: "cairo_exit", resources: [`ticket:${ticket.id}:${ticket.reviewHash}`], save: [], metadata: { ticketId: ticket.id, reviewHash: ticket.reviewHash! }, source: { type: "tool", messageID: source.messageID, id: source.id }, agent: source.agent }, { signal: AbortSignal.timeout(5000) })
    if (permission.effect !== "ask") { this.tickets.invalidate(ticket.id); throw new Error("Generic/saved permissions cannot authorize a Cairo exit; exact review must ask") }
    return new Promise(resolve => {
      const timer = setTimeout(() => { void this.reject(ticket.id, "expired") }, Math.max(1, Date.parse(ticket.expiresAt) - Date.now()))
      this.pending.set(ticket.id, { sessionId, permissionId: permission.id, hash: ticket.reviewHash!, resolve, timer })
    })
  }
  async approve(id: string, hash: string, submit: () => Promise<unknown>): Promise<unknown> {
    const pending = this.pending.get(id)
    if (!pending || pending.hash !== hash) throw new Error("Exact current tool permission binding required")
    if (pending.deciding) throw new Error("This exact permission decision is already in progress")
    this.tickets.approve(id, hash)
    pending.deciding = true; clearTimeout(pending.timer)
    try {
      const client = this.client(); if (!client) throw new Error("Runtime unavailable")
      await client.permission.reply({ sessionID: pending.sessionId, requestID: pending.permissionId, decision: "once" }, { signal: AbortSignal.timeout(5000) })
      // The OpenCode reply is only a tool-continuation signal. Submission consumes the separate engine approval.
      const attempt = await submit(); const result = { available: true, ticketId: id, reviewed: true, attempt }
      this.finish(id, result); return result
    } catch (error) { this.tickets.invalidate(id); this.finish(id, { submitted: false, state: "invalidated", reason: "Permission or broker submission failed; no retry" }); throw error }
  }
  async reject(id: string, reason = "rejected"): Promise<void> {
    const pending = this.pending.get(id); if (!pending) return
    this.tickets.invalidate(id)
    this.finish(id, { submitted: false, state: reason })
    await this.client()?.permission.reply({ sessionID: pending.sessionId, requestID: pending.permissionId, decision: "reject" }, { signal: AbortSignal.timeout(5000) }).catch(() => {})
  }
  async cancelSession(sessionId: string): Promise<void> { await Promise.all([...this.pending].filter(([, pending]) => pending.sessionId === sessionId).map(([id]) => this.reject(id, "canceled"))) }
  async stop(): Promise<void> { await Promise.all([...this.pending.keys()].map(id => this.reject(id, "canceled"))) }
  private finish(id: string, result: unknown): void { const pending = this.pending.get(id); if (!pending) return; clearTimeout(pending.timer); this.pending.delete(id); pending.resolve(result) }
}
