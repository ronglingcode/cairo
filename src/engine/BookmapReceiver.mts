import { BookmapEntryArchive } from "./BookmapEntryArchive.mts"
import { BookmapEvidence } from "./BookmapEvidence.mts"
import { type BookmapObservation } from "../shared/contracts.mts"
import type { CairoEngine } from "./CairoEngine.mts"
import { atrTargetContext, type AtrMarket } from "./AtrTargets.mts"
export const ALLOWED_PATTERNS = ["BID_STEP_UP", "BID_REAPPEAR"] as const // Automatic entry observer eligibility; all plugin patterns remain visible.
export interface ObservedEpisode { observation: BookmapObservation; receivedAt: string; freshEvent: boolean }
export interface BookmapProjection { sourceInstanceId: string | null; heartbeatAt: string | null; symbols: Record<string, { sourceInstanceId: string; epoch: number; mode: string; readiness: string; heartbeatAt: string }>; episodes: ObservedEpisode[] }
export class BookmapReceiver {
  readonly evidence = new BookmapEvidence()
  private archive?: BookmapEntryArchive
  async enableEntryArchive(directory: string): Promise<void> { this.archive=new BookmapEntryArchive(directory,this.evidence); await this.archive.load(); this.tick() }
  async flushArchive(): Promise<void> { await this.archive?.flush() }
  private engine: CairoEngine; private now: () => number; private socket?: WebSocket; private retry?: ReturnType<typeof setTimeout>; private stopped = true
  private projection: BookmapProjection = { sourceInstanceId: null, heartbeatAt: null, symbols: {}, episodes: [] }
  constructor(engine: CairoEngine, now = Date.now) { this.engine = engine; this.now = now }
  private targetMarkets = new Map<string, AtrMarket>()
  atrTargets(symbol: string, side: string) { return atrTargetContext(this.targetMarkets.get(symbol), side, this.now()) }
  private accountActivity?: () => void
  setAccountActivityHandler(handler: () => void): void { this.accountActivity = handler }
  start(endpoint: string): void {
    const url = new URL(endpoint); if (!["ws:", "wss:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error("Bookmap must use loopback")
    this.stopped = false
    const connect = () => {
      if (this.stopped) return
      this.evidence.reset()
      this.targetMarkets.clear()
      this.projection = { sourceInstanceId: null, heartbeatAt: null, symbols: {}, episodes: [] }
      const socket = new WebSocket(endpoint); this.socket = socket
      socket.addEventListener("open", () => { if (socket === this.socket && !this.stopped) this.accountActivity?.() })
      socket.addEventListener("message", event => { if (socket === this.socket && typeof event.data === "string") this.receive(event.data) })
      socket.addEventListener("error", () => socket.close())
      socket.addEventListener("close", () => { if (this.stopped || socket !== this.socket) return; this.evidence.reset(); this.projection = {sourceInstanceId:null,heartbeatAt:null,symbols:{},episodes:[]}; this.targetMarkets.clear(); this.publish("disconnected", "Bookmap disconnected; reconnecting"); this.retry = setTimeout(connect, 2000) })
    }
    connect()
  }
  stop(): void { this.archive?.capture(); this.stopped = true; this.targetMarkets.clear(); clearTimeout(this.retry); this.socket?.close(); this.socket = undefined; this.evidence.reset(); this.projection = {sourceInstanceId:null,heartbeatAt:null,symbols:{},episodes:[]}; this.publish("disconnected", "Observation receiver stopped") }
  receive(raw: string): boolean {
    try {
      if (raw.length > 524_288) return false
      const value = JSON.parse(raw)
      if (value.type === "cairo_target_market") {
        if (typeof value.symbol !== 'string' || !/^[A-Z0-9.\-]{1,16}$/.test(value.symbol) || typeof value.sessionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.sessionDate) || !Number.isSafeInteger(value.timestamp) || value.timestamp > this.now() + 5000 || value.timestamp < this.now() - 60_000 || ![value.atr, value.lowOfDay, value.highOfDay].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) || value.highOfDay < value.lowOfDay) return false
        if ((this.targetMarkets.get(value.symbol)?.timestamp ?? 0) > value.timestamp) return false
        this.targetMarkets.set(value.symbol, { symbol: value.symbol, sessionDate: value.sessionDate, timestamp: value.timestamp, atr: value.atr, lowOfDay: value.lowOfDay, highOfDay: value.highOfDay })
        if (this.targetMarkets.size > 100) this.targetMarkets.delete(this.targetMarkets.keys().next().value!)
        return true
      }
      if (value.type === "cairo_account_activity") {
        if (!Number.isSafeInteger(value.receivedAt) || value.receivedAt > this.now() + 5000 || value.receivedAt < this.now() - 60_000 || !Array.isArray(value.messageTypes) || value.messageTypes.length > 32 || !value.messageTypes.every((type: unknown) => typeof type === "string" && /^[A-Za-z0-9_]{1,80}$/.test(type))) return false
        this.accountActivity?.()
        return true
      }
      if (value.type === "cairo_patterns") {
        if (!this.evidence.receive(value, this.now())) return false
        this.projectAggregate(value)
        const facts = this.engine.getSnapshot().brokerFacts
        if (facts) this.evidence.associate(facts)
        this.tick()
        return true
      }
      return false
    } catch { return false }
  }
  private projectAggregate(value: {symbol:string;sourceInstanceId:string;epoch:number;sequence:number;mode:BookmapObservation["mode"];readiness:BookmapObservation["readiness"];delivery:string;eventTime:string;detectorRevision:string;configRevision:string}):void {
    const status=this.evidence.snapshot().symbols[value.symbol]!
    const receivedAt=status.receivedAt
    const previous=this.projection.episodes.filter(item=>item.observation.symbol.canonical===value.symbol)
    this.projection.sourceInstanceId=value.sourceInstanceId
    this.projection.heartbeatAt=receivedAt
    this.projection.symbols[value.symbol]={sourceInstanceId:value.sourceInstanceId,epoch:value.epoch,mode:value.mode,readiness:value.readiness,heartbeatAt:receivedAt}
    const episodes=status.observations.map(event=>{
      const prior=previous.find(item=>item.observation.sourceInstanceId===value.sourceInstanceId&&item.observation.episodeId===event.id)
      const eventMs=Number(BigInt(event.observedAt)/1_000_000n)
      // A reconnect snapshot cannot create live eligibility; repeated heartbeats cannot promote it.
      const freshEvent=prior?prior.freshEvent:value.delivery==="stream"&&eventMs<=this.now()&&this.now()-eventMs<=10_000
      const observation:BookmapObservation={sourceInstanceId:value.sourceInstanceId,sequence:value.sequence,symbol:{source:value.symbol,canonical:value.symbol},priceUnit:"USD",episodeId:event.id,revision:event.revision,pattern:event.type,price:event.price,eventTime:event.eventTime,receivedAt:(BigInt(this.now())*1_000_000n).toString(),detectorRevision:value.detectorRevision,configRevision:value.configRevision,mode:value.mode,readiness:value.readiness,delivery:value.delivery==="snapshot"?"snapshot":"live",kind:"episode"}
      return {observation,receivedAt,freshEvent}
    })
    this.projection.episodes=[...this.projection.episodes.filter(item=>item.observation.symbol.canonical!==value.symbol),...episodes].slice(-400)
  }
  tick(): void {
    const facts = this.engine.getSnapshot().brokerFacts
    if (facts) this.evidence.associate(facts)
    this.archive?.capture()
    const evidence = this.evidence.snapshot()
    const evidenceFresh = Object.values(evidence.symbols).some(s => this.now() - Date.parse(s.receivedAt) <= 6000)
    const fresh = evidenceFresh || this.projection.heartbeatAt !== null && this.now() - Date.parse(this.projection.heartbeatAt) <= 6000
    this.publish(fresh ? "connected" : "stale", fresh ? "Plugin aggregates connected; patterns and signals come from SignalComposer" : "Heartbeat unavailable or stale; observations cannot trigger actions")
  }
  private publish(state: "connected" | "disconnected" | "stale", detail: string): void { this.engine.updateSnapshot({ bookmap: { source: "bookmap", state, updatedAt: this.projection.heartbeatAt, detail }, bookmapProjection: this.projection, bookmapEvidence: this.evidence.snapshot() }) }
}
