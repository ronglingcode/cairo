import { createHash, randomUUID } from "node:crypto"
import type { CairoEngine } from "../engine/CairoEngine.mts"
export interface WakeStatus { enabled: boolean; bookmapEnabled: boolean; pending: boolean; lastSentAt: string | null; error: string | null }
interface WakeChat { snapshot: { connected: boolean; busy: boolean; outcome: string | null }; notify(text: string, id: string): Promise<void> }
const lane = () => ({ pending: null as string | null, sending: false, lastSent: -Infinity, interruptionSeen: false, error: null as string | null })
export class CopilotWaker {
  private engine: CairoEngine; private chat: WakeChat; private accountChat: WakeChat; private now: () => number
  private bookmapFingerprint = ""
  private fingerprint = ""
  private lanes = { account: lane(), bookmap: lane() }
  private state: WakeStatus = { enabled: false, bookmapEnabled: true, pending: false, lastSentAt: null, error: null }
  constructor(engine: CairoEngine, chat: WakeChat, now: () => number = Date.now, accountChat: WakeChat = chat) { this.engine = engine; this.chat = chat; this.accountChat = accountChat; this.now = now; this.publish() }
  setEnabled(enabled: boolean): void { if (typeof enabled !== "boolean") throw new Error("Explicit event-update choice required"); this.state.enabled = enabled; this.lanes.account.error = null; this.lanes.account.pending = null; this.fingerprint = this.current().fingerprint; this.lanes.account.interruptionSeen = this.accountChat.snapshot.outcome === "interrupted"; this.publish() }
  setBookmapEnabled(enabled: boolean): void { if (typeof enabled !== "boolean") throw new Error("Bookmap AI choice required"); this.state.bookmapEnabled=enabled; this.lanes.bookmap.error=null; this.lanes.bookmap.pending=null; this.bookmapFingerprint=this.current().bookmapFingerprint; this.lanes.bookmap.interruptionSeen=this.chat.snapshot.outcome === "interrupted"; this.publish() }
  cycle(): void {
    const current = this.current()
    if (this.fingerprint && current.fingerprint !== this.fingerprint && this.state.enabled) this.lanes.account.pending = current.accountText
    if (current.bookmapFingerprint !== this.bookmapFingerprint && this.state.bookmapEnabled && current.hasSetups) this.lanes.bookmap.pending=current.bookmapText
    if (!current.hasSetups) this.lanes.bookmap.pending=null
    this.bookmapFingerprint=current.bookmapFingerprint
    this.fingerprint = current.fingerprint
    this.deliver("account", this.accountChat, "enabled", 15_000)
    this.deliver("bookmap", this.chat, "bookmapEnabled", 3000)
    this.publish()
  }
  private deliver(kind: "account" | "bookmap", chat: WakeChat, enabled: "enabled" | "bookmapEnabled", interval: number): void {
    const queue = this.lanes[kind]
    if (chat.snapshot.outcome === "interrupted" && !queue.interruptionSeen && this.state[enabled]) { this.state[enabled]=false; queue.pending=null; queue.error=`${kind} updates paused after cancellation` }
    queue.interruptionSeen=chat.snapshot.outcome === "interrupted"
    if (!this.state[enabled] || !queue.pending || queue.sending || this.now()-queue.lastSent < interval || !chat.snapshot.connected || chat.snapshot.busy) return
    const text=queue.pending; queue.pending=null; queue.sending=true; queue.lastSent=this.now()
    void chat.notify(text, `cairo-${kind}-${randomUUID()}`).then(() => { this.state.lastSentAt=new Date(this.now()).toISOString() }).catch(() => { this.state[enabled]=false; queue.pending=null; queue.error=`${kind} delivery uncertain; inspect chat before re-enabling updates` }).finally(() => { queue.sending=false; this.publish() })
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
  private publish(): void { this.state.pending=Boolean(this.lanes.account.pending || this.lanes.bookmap.pending); this.state.error=[this.lanes.account.error,this.lanes.bookmap.error].filter(Boolean).join("; ") || null; if (JSON.stringify(this.engine.getSnapshot().copilotWake) !== JSON.stringify(this.state)) this.engine.updateSnapshot({ copilotWake: structuredClone(this.state) }) }
}
