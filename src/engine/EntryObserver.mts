import { randomUUID } from "node:crypto"
import type { CairoEngine } from "./CairoEngine.mts"
import type { Tradebook, BookmapObservation } from "../shared/contracts.mts"
import { ALLOWED_PATTERNS } from "./BookmapReceiver.mts"
export interface ObservationAttempt {
  id: string; symbol: string; pattern: string; tradebook: Tradebook; sourceInstanceId: string; accountId: string
  activatedAt: string; expiresAt: string; baselineEpisodes: string[]; state: "active" | "alerted" | "inactive" | "expired"; detail: string
  signal: { id: string; evidence: BookmapObservation } | null
}
export class EntryObserver {
  private engine: CairoEngine; private now: () => number
  constructor(engine: CairoEngine, now = Date.now) { this.engine = engine; this.now = now }
  activate(input: { symbol: string; pattern: string; tradebookId: string; expectedRevision: string; reviewed: boolean; confirmedClauses: string[] }): ObservationAttempt {
    const snapshot = this.engine.getSnapshot(); const book = snapshot.tradebooks.find(item => item.id === input.tradebookId && item.revision === input.expectedRevision)
    if (!book?.interpretation || input.reviewed !== true || !/^[A-Z0-9.\-]{1,16}$/.test(input.symbol) || !ALLOWED_PATTERNS.includes(input.pattern as typeof ALLOWED_PATTERNS[number]) || !Array.isArray(input.confirmedClauses)) throw new Error("Review a current narrative, symbol and supported pattern")
    if (book.interpretation.clauses.some(clause => clause.mandatory && clause.coverage !== "deterministic" && !input.confirmedClauses.includes(clause.clauseId))) throw new Error("Explicitly confirm every mandatory discretionary/unsupported clause for this attempt")
    if (!snapshot.bookmapProjection.sourceInstanceId || !snapshot.brokerFacts?.accountId) throw new Error("Current observation source and selected broker account required")
    const activatedAt = new Date(this.now()).toISOString()
    const attempt: ObservationAttempt = { id: randomUUID(), symbol: input.symbol, pattern: input.pattern, tradebook: structuredClone(book), accountId: snapshot.brokerFacts.accountId, sourceInstanceId: snapshot.bookmapProjection.sourceInstanceId, activatedAt, expiresAt: new Date(this.now() + 300_000).toISOString(), baselineEpisodes: snapshot.bookmapProjection.episodes.map(item => item.observation.episodeId), state: "active", detail: "Waiting for a fresh eligible episode; no entry orders", signal: null }
    this.engine.updateSnapshot({ observationAttempts: [...snapshot.observationAttempts.map(item => item.state === "active" || item.state === "alerted" ? { ...item, state: "inactive" as const, detail: "Replaced by reviewed attempt" } : item), attempt].slice(-20) }); return attempt
  }
  deactivate(id: string): void { this.engine.updateSnapshot({ observationAttempts: this.engine.getSnapshot().observationAttempts.map(item => item.id === id ? { ...item, state: "inactive", detail: "Deactivated by trader" } : item) }) }
  cycle(): void {
    const snapshot = this.engine.getSnapshot(); const now = this.now(); const facts = snapshot.brokerFacts
    const attempts = snapshot.observationAttempts.map(attempt => {
      if (!["active", "alerted"].includes(attempt.state)) return attempt
      if (Date.parse(attempt.expiresAt) <= now) return { ...attempt, state: "expired" as const, detail: "Expired; review and activate a new attempt to rearm" }
      if (snapshot.bookmapProjection.sourceInstanceId !== attempt.sourceInstanceId || !snapshot.bookmapProjection.symbols[attempt.symbol]) return { ...attempt, state: "inactive" as const, detail: "Source reset/disconnected; review and rearm" }
      const status = snapshot.bookmapProjection.symbols[attempt.symbol]
      const gate = snapshot.bookmap.state === "connected" && status.mode === "live" && status.readiness === "ready" && now - Date.parse(status.heartbeatAt) >= 0 && now - Date.parse(status.heartbeatAt) <= 6000 && facts?.accountId === attempt.accountId && facts.ordersComplete && snapshot.broker.state === "connected" && facts.source.state === "connected" && now - Date.parse(facts.asOf) >= 0 && now - Date.parse(facts.asOf) <= 60_000 && !facts.positions.some(item => item.symbol === attempt.symbol) && !facts.workingOrders.some(item => item.symbol === attempt.symbol)
      if (!gate) return { ...attempt, detail: "Blocked: fresh complete flat account and proven live/ready source required" }
      const episode = snapshot.bookmapProjection.episodes.slice().reverse().find(item => item.observation.sourceInstanceId === attempt.sourceInstanceId && item.observation.symbol.canonical === attempt.symbol && item.observation.pattern === attempt.pattern && item.freshEvent && item.observation.mode === "live" && item.observation.readiness === "ready" && !attempt.baselineEpisodes.includes(item.observation.episodeId) && Number(BigInt(item.observation.eventTime!) / 1_000_000n) >= Date.parse(attempt.activatedAt) && now - Number(BigInt(item.observation.eventTime!) / 1_000_000n) <= 10_000 && (!attempt.signal || item.observation.episodeId === attempt.signal.evidence.episodeId))
      if (!episode) return attempt
      return { ...attempt, state: "alerted" as const, detail: "Observer recommendation only: enter externally after your own review", signal: { id: attempt.signal?.id ?? randomUUID(), evidence: episode.observation } }
    })
    if (JSON.stringify(attempts) !== JSON.stringify(snapshot.observationAttempts)) this.engine.updateSnapshot({ observationAttempts: attempts })
  }
}
