import { createHash, randomUUID } from "node:crypto"
import type { CairoEngine } from "../engine/CairoEngine.mts"
export interface WakeStatus { enabled: boolean; pending: boolean; lastSentAt: string | null; error: string | null }
interface WakeChat { snapshot: { connected: boolean; busy: boolean; outcome: string | null }; notify(text: string, id: string): Promise<void> }
export class CopilotWaker {
  private engine: CairoEngine; private chat: WakeChat; private now: () => number
  private fingerprint = ""; private pending: string | null = null; private sending = false; private lastSent = -Infinity
  private interruptionSeen = false
  private state: WakeStatus = { enabled: false, pending: false, lastSentAt: null, error: null }
  constructor(engine: CairoEngine, chat: WakeChat, now: () => number = Date.now) { this.engine = engine; this.chat = chat; this.now = now; this.publish() }
  setEnabled(enabled: boolean): void { if (typeof enabled !== "boolean") throw new Error("Explicit event-update choice required"); this.state.enabled = enabled; this.state.error = null; this.pending = null; this.fingerprint = this.current().fingerprint; this.interruptionSeen = this.chat.snapshot.outcome === "interrupted"; this.publish() }
  cycle(): void {
    const current = this.current()
    if (this.fingerprint && current.fingerprint !== this.fingerprint && this.state.enabled) this.pending = current.text
    this.fingerprint = current.fingerprint
    if (this.chat.snapshot.outcome === "interrupted" && !this.interruptionSeen && this.state.enabled) { this.state.enabled = false; this.pending = null; this.state.error = "Automatic updates paused after cancellation" }
    this.interruptionSeen = this.chat.snapshot.outcome === "interrupted"
    this.state.pending = Boolean(this.pending); this.publish()
    if (!this.state.enabled || !this.pending || this.sending || this.now() - this.lastSent < 15_000 || !this.chat.snapshot.connected || this.chat.snapshot.busy) return
    const text = this.pending; this.pending = null; this.sending = true; this.lastSent = this.now()
    void this.chat.notify(text, `cairo-event-${randomUUID()}`).then(() => { this.state.lastSentAt = new Date(this.now()).toISOString() }).catch(() => { this.state.enabled = false; this.pending = null; this.state.error = "Event delivery uncertain; inspect chat before re-enabling updates" }).finally(() => { this.sending = false; this.state.pending = Boolean(this.pending); this.publish() })
  }
  private current() {
    const snapshot = this.engine.getSnapshot(); const facts = snapshot.brokerFacts
    const data = { accountId: facts?.accountId, positions: facts?.positions.map(({ positionId, symbol, side, quantity, averagePrice }) => ({ positionId, symbol, side, quantity, averagePrice })), orders: facts?.workingOrders, fills: facts?.recentFills.map(fill => fill.fillId), recommendations: snapshot.recommendations.filter(item => item.state === "current").map(item => ({ id: item.id, symbol: item.symbol, quantity: item.quantity })) }
    const serialized = JSON.stringify(data)
    return { fingerprint: createHash("sha256").update(serialized).digest("hex"), text: `Machine observation only; no trading approval. Assess meaningful account/recommendation changes using freshly injected preparation and each position's frozen guidance. Do not infer a live trigger from snapshot candles. Latest summary (possibly truncated): ${serialized.slice(0, 7000)}` }
  }
  private publish(): void { if (JSON.stringify(this.engine.getSnapshot().copilotWake) !== JSON.stringify(this.state)) this.engine.updateSnapshot({ copilotWake: structuredClone(this.state) }) }
}
