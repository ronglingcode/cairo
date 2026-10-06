import { BookmapEntryArchive } from "./BookmapEntryArchive.mts"
import { BookmapEvidence } from "./BookmapEvidence.mts"
import { parseBookmapObservation, type BookmapObservation } from "../shared/contracts.mts"
import type { CairoEngine } from "./CairoEngine.mts"
export const ALLOWED_PATTERNS = ["BID_STEP_UP", "BID_REAPPEAR"] as const
export interface ObservedEpisode { observation: BookmapObservation; receivedAt: string; freshEvent: boolean }
export interface BookmapProjection { sourceInstanceId: string | null; heartbeatAt: string | null; symbols: Record<string, { mode: string; readiness: string; heartbeatAt: string }>; episodes: ObservedEpisode[] }
export class BookmapReceiver {
  readonly evidence = new BookmapEvidence({ bounceTicks: Number(process.env.CAIRO_BOOKMAP_BOUNCE_TICKS || 2), bounceDurationMs: Number(process.env.CAIRO_BOOKMAP_BOUNCE_MS || 200), noBounceCoverageMs: Number(process.env.CAIRO_BOOKMAP_COVERAGE_MS || 5000), offerMaxOvershootPct: Number(process.env.CAIRO_BOOKMAP_OFFER_MAX_OVERSHOOT_PCT || 1), offerReturnMs: Number(process.env.CAIRO_BOOKMAP_OFFER_RETURN_MS || 5000), offerHoldBelowMs: Number(process.env.CAIRO_BOOKMAP_OFFER_HOLD_MS || 1000) })
  private archive?: BookmapEntryArchive
  async enableEntryArchive(directory: string): Promise<void> { this.archive=new BookmapEntryArchive(directory,this.evidence); await this.archive.load(); this.tick() }
  async flushArchive(): Promise<void> { await this.archive?.flush() }
  private publishTimer?: ReturnType<typeof setTimeout>
  private engine: CairoEngine; private now: () => number; private socket?: WebSocket; private retry?: ReturnType<typeof setTimeout>; private stopped = true
  private projection: BookmapProjection = { sourceInstanceId: null, heartbeatAt: null, symbols: {}, episodes: [] }
  constructor(engine: CairoEngine, now = Date.now) { this.engine = engine; this.now = now }
  start(endpoint: string): void {
    const url = new URL(endpoint); if (!["ws:", "wss:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error("Bookmap must use loopback")
    this.stopped = false
    const connect = () => {
      if (this.stopped) return
      this.evidence.reset()
      this.projection = { sourceInstanceId: null, heartbeatAt: null, symbols: {}, episodes: [] }
      const socket = new WebSocket(endpoint); this.socket = socket
      socket.addEventListener("message", event => { if (socket === this.socket && typeof event.data === "string") this.receive(event.data) })
      socket.addEventListener("error", () => socket.close())
      socket.addEventListener("close", () => { if (this.stopped || socket !== this.socket) return; this.publish("disconnected", "Bookmap disconnected; reconnecting"); this.retry = setTimeout(connect, 2000) })
    }
    connect()
  }
  stop(): void { this.archive?.capture(); this.stopped = true; clearTimeout(this.retry); clearTimeout(this.publishTimer); this.socket?.close(); this.socket = undefined; this.publish("disconnected", "Observation receiver stopped") }
  receive(raw: string): boolean {
    try {
      if (raw.length > 131_072) return false
      const value = JSON.parse(raw)
      if (value.type === "cairo_evidence") {
        if (!this.evidence.receive(value, this.now())) return false
        const facts = this.engine.getSnapshot().brokerFacts
        if (facts) this.evidence.associate(facts)
        if (!this.publishTimer) this.publishTimer=setTimeout(()=>{this.publishTimer=undefined;this.tick()},100)
        // First batch establishes status immediately; later batches coalesce to protect rendering.
        if (!Object.keys(this.engine.getSnapshot().bookmapEvidence.symbols).length) this.tick()
        return true
      }
      if (value.type !== "cairo_observation") return false
      const observation = parseBookmapObservation(value)
      if (!/^[A-Z0-9.\-]{1,16}$/.test(observation.symbol.canonical) || observation.symbol.source.split(/[:@]/)[0].toUpperCase() !== observation.symbol.canonical || !Number.isSafeInteger(observation.sequence) || !Number.isSafeInteger(observation.revision)) return false
      if (observation.kind === "episode" && (!ALLOWED_PATTERNS.includes(observation.pattern as typeof ALLOWED_PATTERNS[number]) || observation.price === null || observation.price <= 0 || !observation.eventTime)) return false
      if (this.projection.sourceInstanceId !== observation.sourceInstanceId) this.projection = { sourceInstanceId: observation.sourceInstanceId, heartbeatAt: null, symbols: {}, episodes: [] }
      const receivedAt = new Date(this.now()).toISOString(); const symbol = observation.symbol.canonical
      if (observation.kind === "reset") { this.projection.episodes = this.projection.episodes.filter(item => item.observation.symbol.canonical !== symbol); delete this.projection.symbols[symbol] }
      else if (observation.kind === "heartbeat") {
        this.projection.heartbeatAt = receivedAt; this.projection.symbols[symbol] = { mode: observation.mode, readiness: observation.readiness, heartbeatAt: receivedAt }
        const keys = Object.keys(this.projection.symbols); if (keys.length > 100) delete this.projection.symbols[keys[0]!]
      } else {
        const prior = this.projection.episodes.find(item => item.observation.symbol.canonical === symbol && item.observation.episodeId === observation.episodeId)
        if (prior && (prior.observation.revision >= observation.revision || prior.observation.sequence >= observation.sequence)) return false
        const eventMs = Number(BigInt(observation.eventTime!) / 1_000_000n)
        const freshEvent = observation.delivery === "live" && eventMs <= this.now() && this.now() - eventMs <= 10_000 && (prior ? prior.freshEvent : true)
        this.projection.episodes = [...this.projection.episodes.filter(item => item !== prior), { observation, receivedAt, freshEvent }].slice(-400)
      }
      this.tick(); return true
    } catch { return false }
  }
  tick(): void {
    const facts = this.engine.getSnapshot().brokerFacts
    if (facts) this.evidence.associate(facts)
    this.archive?.capture()
    const evidence = this.evidence.snapshot()
    const evidenceFresh = Object.values(evidence.symbols).some(s => this.now() - Date.parse(s.receivedAt) <= 6000)
    const fresh = evidenceFresh || this.projection.heartbeatAt !== null && this.now() - Date.parse(this.projection.heartbeatAt) <= 6000
    this.publish(fresh ? "connected" : "stale", fresh ? "Observations connected; live eligibility requires proven live mode and ready depth" : "Heartbeat unavailable or stale; observations cannot trigger actions")
  }
  private publish(state: "connected" | "disconnected" | "stale", detail: string): void { this.engine.updateSnapshot({ bookmap: { source: "bookmap", state, updatedAt: this.projection.heartbeatAt, detail }, bookmapProjection: this.projection, bookmapEvidence: this.evidence.snapshot() }) }
}
