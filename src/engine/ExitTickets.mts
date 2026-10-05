import { createHash, randomUUID } from "node:crypto"
import type { CairoEngine } from "./CairoEngine.mts"
import type { CairoSnapshot, ExitTicket } from "../shared/contracts.mts"
import { validateExit, type ExitIntent } from "./ExitEligibility.mts"
export class ExitTickets {
  private engine: CairoEngine; private now: () => number
  private preflight: () => void = () => {}
  setPreflight(preflight: () => void): void { this.preflight = preflight }
  private commands = new Map<string, { content: string; ticketId: string }>()
  private requests = new Map<string, { intent: ExitIntent; origin: "trader" | "copilot" }>()
  constructor(engine: CairoEngine, now: () => number = Date.now) { this.engine = engine; this.now = now }
  stage(input: ExitIntent, origin: "trader" | "copilot"): ExitTicket {
    this.preflight()
    this.cycle()
    const commandKey = `${origin}:${input.commandId}`; const content = JSON.stringify(input)
    const previous = this.commands.get(commandKey)
    if (previous) {
      if (previous.content !== content) throw new Error("Request identity already bound to different details")
      const ticket = this.engine.getSnapshot().tickets.find(item => item.id === previous.ticketId)
      if (!ticket || ticket.state !== "staged") throw new Error("Previous draft is no longer current; review fresh facts before proposing again")
      return structuredClone(ticket)
    }
    const snapshot = this.engine.getSnapshot(); const eligible = validateExit(snapshot, input, origin, this.now())
    if (input.recommendationId) {
      const existing = snapshot.tickets.find(item => item.recommendationId === input.recommendationId && item.state === "staged")
      if (existing) { this.commands.set(commandKey, { content, ticketId: existing.id }); return structuredClone(existing) }
    }
    const ticket: ExitTicket = { id: randomUUID(), accountId: input.accountId, positionId: input.positionId, symbol: input.symbol, positionSide: eligible.position.side, action: input.intent,
      quantity: input.quantity, orderId: input.orderId ?? null, request: eligible.request, reason: input.reason, sourceClauseId: eligible.sourceClauseId,
      expiresAt: new Date(this.now() + 60_000).toISOString(), state: "staged", createdAt: new Date(this.now()).toISOString(), runtimeInstanceId: snapshot.runtimeInstanceId,
      exactPayload: eligible.payload, affectedOrders: eligible.affectedOrders, factsRevision: snapshot.brokerFactsRevision, factsFingerprint: exitFactsFingerprint(snapshot),
      recommendationId: input.recommendationId ?? null, attachmentRevision: eligible.attachmentRevision, origin }
    this.commands.set(commandKey, { content, ticketId: ticket.id }); if (this.commands.size > 500) this.commands.delete(this.commands.keys().next().value!)
    this.requests.set(ticket.id, { intent: structuredClone(input), origin })
    this.engine.updateSnapshot({ tickets: [...snapshot.tickets, ticket].slice(-200) }); return structuredClone(ticket)
  }
  dismiss(id: string): void {
    const snapshot = this.engine.getSnapshot(); const ticket = snapshot.tickets.find(item => item.id === id && item.state === "staged")
    if (!ticket) throw new Error("Current staged ticket required")
    this.engine.updateSnapshot({ tickets: snapshot.tickets.map(item => item.id === id ? { ...item, state: "dismissed" } : item) })
  }
  cycle(): void {
    const snapshot = this.engine.getSnapshot(); const fingerprint = exitFactsFingerprint(snapshot); let changed = false
    const tickets = snapshot.tickets.map(ticket => {
      if (ticket.state !== "staged") return ticket
      const request = this.requests.get(ticket.id)
      let invalid = Date.parse(ticket.expiresAt) <= this.now() || ticket.runtimeInstanceId !== snapshot.runtimeInstanceId || ticket.factsFingerprint !== fingerprint || !request
      if (!invalid && request) try { validateExit(snapshot, { ...request.intent, factsRevision: snapshot.brokerFactsRevision }, request.origin, this.now()) } catch { invalid = true }
      if (invalid) { changed = true; return { ...ticket, state: "invalidated" as const } } return ticket
    })
    if (changed) this.engine.updateSnapshot({ tickets })
    const live = new Set(tickets.filter(ticket => ticket.state === "staged").map(ticket => ticket.id))
    for (const id of this.requests.keys()) if (!live.has(id)) this.requests.delete(id)
  }
}
export function exitFactsFingerprint(snapshot: CairoSnapshot): string {
  const facts = snapshot.brokerFacts
  return createHash("sha256").update(JSON.stringify({ accountId: facts?.accountId, ordersComplete: facts?.ordersComplete,
    positions: facts?.positions.map(({ positionId, symbol, side, quantity, averagePrice }) => ({ positionId, symbol, side, quantity, averagePrice })).sort((a, b) => a.positionId.localeCompare(b.positionId)),
    orders: facts?.workingOrders.slice().sort((a, b) => `${a.orderId}:${a.symbol}`.localeCompare(`${b.orderId}:${b.symbol}`)),
    fills: facts?.recentFills.slice().sort((a, b) => a.fillId.localeCompare(b.fillId)) })).digest("hex")
}
