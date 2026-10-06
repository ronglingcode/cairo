import { createHash, randomUUID } from "node:crypto"
import type { CairoEngine } from "../engine/CairoEngine.mts"
export interface WakeStatus { enabled: boolean; bookmapEnabled: boolean; pending: boolean; lastSentAt: string | null; error: string | null }
interface WakeChat { snapshot: { connected: boolean; busy: boolean; outcome: string | null }; notify(text: string, id: string): Promise<void> }
export class CopilotWaker {
  private engine: CairoEngine; private chat: WakeChat; private now: () => number
  private bookmapFingerprint = ""; private bookmapPending = false
  private fingerprint = ""; private pending: string | null = null; private sending = false; private lastSent = -Infinity
  private interruptionSeen = false
  private state: WakeStatus = { enabled: false, bookmapEnabled: true, pending: false, lastSentAt: null, error: null }
  constructor(engine: CairoEngine, chat: WakeChat, now: () => number = Date.now) { this.engine = engine; this.chat = chat; this.now = now; this.publish() }
  setEnabled(enabled: boolean): void { if (typeof enabled !== "boolean") throw new Error("Explicit event-update choice required"); this.state.enabled = enabled; this.state.error = null; this.pending = null; this.fingerprint = this.current().fingerprint; this.interruptionSeen = this.chat.snapshot.outcome === "interrupted"; this.publish() }
  setBookmapEnabled(enabled: boolean): void { if (typeof enabled !== "boolean") throw new Error("Bookmap AI choice required"); this.state.bookmapEnabled=enabled; this.bookmapFingerprint=this.current().bookmapFingerprint; if(!enabled && this.bookmapPending) {this.pending=null; this.bookmapPending=false} this.publish() }
  cycle(): void {
    const current = this.current()
    if (this.fingerprint && current.fingerprint !== this.fingerprint && this.state.enabled) { this.pending = current.accountText; this.bookmapPending=false }
    if (current.bookmapFingerprint !== this.bookmapFingerprint && this.state.bookmapEnabled && current.hasSetups) { this.pending=current.bookmapText; this.bookmapPending=true }
    if (!current.hasSetups && this.bookmapPending) { this.pending=null; this.bookmapPending=false }
    this.bookmapFingerprint=current.bookmapFingerprint
    this.fingerprint = current.fingerprint
    if (this.chat.snapshot.outcome === "interrupted" && !this.interruptionSeen && (this.state.enabled || this.state.bookmapEnabled)) { this.state.enabled = false; this.state.bookmapEnabled=false; this.pending = null; this.state.error = "Automatic updates paused after cancellation" }
    this.interruptionSeen = this.chat.snapshot.outcome === "interrupted"
    this.state.pending = Boolean(this.pending); this.publish()
    if ((!this.state.enabled && !this.state.bookmapEnabled) || !this.pending || this.sending || this.now() - this.lastSent < (this.bookmapPending ? 3000 : 15_000) || !this.chat.snapshot.connected || this.chat.snapshot.busy) return
    const text = this.pending; this.pending = null; this.bookmapPending=false; this.sending = true; this.lastSent = this.now()
    void this.chat.notify(text, `cairo-event-${randomUUID()}`).then(() => { this.state.lastSentAt = new Date(this.now()).toISOString() }).catch(() => { this.state.enabled = false; this.state.bookmapEnabled=false; this.pending = null; this.state.error = "Event delivery uncertain; inspect chat before re-enabling updates" }).finally(() => { this.sending = false; this.state.pending = Boolean(this.pending); this.publish() })
  }
  private current() {
    const snapshot = this.engine.getSnapshot(); const facts = snapshot.brokerFacts
    const data = { accountId: facts?.accountId, positions: facts?.positions.map(({ positionId, symbol, side, quantity, averagePrice }) => ({ positionId, symbol, side, quantity, averagePrice })), orders: facts?.workingOrders, fills: facts?.recentFills.map(fill => fill.fillId), recommendations: snapshot.recommendations.filter(item => item.state === "current").map(item => ({ id: item.id, symbol: item.symbol, quantity: item.quantity })) }
    const setups = Object.values(snapshot.bookmapEvidence.symbols).filter(s=>this.now()-Date.parse(s.receivedAt)<=6000 && s.readiness==="ready").flatMap(s => s.setups.slice(-2).map(c => ({ id:c.id, revision:c.revision, symbol:c.symbol, mode:s.mode, patternId:c.patternId, state:c.state })))
    const offerObservations = Object.values(snapshot.bookmapEvidence.symbols).filter(s=>this.now()-Date.parse(s.receivedAt)<=6000 && s.readiness==="ready").flatMap(s=>s.observations.slice(-4).map(o=>({id:o.id,symbol:o.symbol,mode:s.mode,kind:o.kind,state:o.state,returning:o.returnTime!==null})))
    const observations = snapshot.bookmapProjection.episodes.filter(item => item.freshEvent && item.observation.mode === "live" && item.observation.readiness === "ready").map(item => ({ source: item.observation.sourceInstanceId, episode: item.observation.episodeId, revision: item.observation.revision, symbol: item.observation.symbol.canonical, pattern: item.observation.pattern }))
    const serialized = JSON.stringify({setups,offerObservations})
    return { hasSetups: setups.length>0 || offerObservations.length>0, bookmapFingerprint: JSON.stringify({setups,offerObservations}), fingerprint: createHash("sha256").update(JSON.stringify({...data,observations})).digest("hex"), accountText: `Machine account observation only; no trading approval. Assess meaningful account/recommendation changes using freshly injected preparation and each position's frozen guidance. Latest account summary: ${JSON.stringify({...data,observations}).slice(0,7000)}`,
      bookmapText: `Bookmap observation update only. Focus on the changed market observations; do not assess account changes or discuss broker freshness for this request. No trading approval. For card explanation text, write one short sentence of at most 180 characters: result and the main reason or uncertainty. No revision IDs, diagnostic boilerplate, repeated replay warnings or broker status. Keep chat acknowledgments equally brief. For changed Bookmap setups, use read_setup_candidates and read_bookmap_timeline to recognize independently, then interpret_bookmap_setup to update its local card with the evidence-based explanation. For offer observations, read_setup_candidates and read_bookmap_timeline, then interpret_bookmap_observation to update its local observation card and explain the breakout or small-overshoot quick-return rejection. These are context/confirmation only, never standalone trade patterns. A crossed offer is not proof of consumption. Replay setups and observations are analysis only; never attach them to live positions. Do not infer a live trigger from snapshot candles. Describe observation-card updates as local card updates, not publication. Current local observation explanations: ${JSON.stringify(snapshot.bookmapEvidence.observationAnalyses.map(a=>({id:a.observationId,revision:a.revision}))).slice(0,1000)}. When the current observation ID/revision has no local explanation, update its card even if the same observation was discussed or updated earlier in chat; a restart can clear local cards while preserving chat history. If a card update reports changed/missing evidence, refresh candidate/timeline once and retry with the latest revision and recorded IDs; if it still fails, explain the specific reason rather than repeating an unchanged update. Latest Bookmap summary (possibly truncated): ${serialized.slice(0, 7000)}` }
  }
  private publish(): void { if (JSON.stringify(this.engine.getSnapshot().copilotWake) !== JSON.stringify(this.state)) this.engine.updateSnapshot({ copilotWake: structuredClone(this.state) }) }
}
