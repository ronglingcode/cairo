import { randomUUID } from "node:crypto"
import type { CairoEngine } from "../engine/CairoEngine.mts"
import type { BrokerPosition, CopilotChat } from "../shared/contracts.mts"

export interface PartialManagementStatus {
  enabled: boolean
  pending: number
  activeSymbol: string | null
  lastReminder: { symbol: string; at: string } | null
  error: string | null
}
interface TrackedTrade {
  position: BrokerPosition
  initial: number
  since: number
  fills: Set<string>
  added: number
  exited: number
  triggered: boolean
}
interface Request { key: string; trade: TrackedTrade; id: string }
interface ManagementChat {
  snapshot: Pick<CopilotChat, "connected" | "busy" | "outcome" | "messages">
  sendAutomatic(text: string, id: string): Promise<void>
}

/** Broker-confirmed partials request advice once per observed trade, independently of manual chat. */
export class PartialManagement {
  private trades = new Map<string, TrackedTrade>()
  private queue: Request[] = []
  private active: { request: Request; previousMessages: Set<string> } | null = null
  private sending = false
  private generation = 0
  private engine: CairoEngine
  private chat: ManagementChat
  private prepare: (positionId: string) => Promise<string>
  private alert: (symbol: string) => void
  private now: () => number
  private state: PartialManagementStatus = { enabled: true, pending: 0, activeSymbol: null, lastReminder: null, error: null }
  constructor(
    engine: CairoEngine,
    chat: ManagementChat,
    prepare: (positionId: string) => Promise<string>,
    alert: (symbol: string) => void,
    now: () => number = Date.now,
  ) { this.engine = engine; this.chat = chat; this.prepare = prepare; this.alert = alert; this.now = now; this.observe(); this.publish() }

  get ownsAutomaticChat(): boolean { return this.sending || Boolean(this.active) || this.queue.length > 0 }
  setEnabled(enabled: boolean): void {
    if (typeof enabled !== "boolean") throw new Error("Explicit partial reminder choice required")
    this.state.enabled = enabled
    this.state.error = null
    this.generation++
    this.queue = []
    this.active = null
    this.publish()
  }
  cycle(): void {
    this.observe()
    if (this.active && !this.sending) {
      const chat = this.chat.snapshot
      if (chat.outcome === "interrupted") { this.setEnabled(false); return }
      if (!chat.connected || (!chat.busy && chat.outcome === "failed")) {
        this.state.error = `${this.active.request.trade.position.symbol}: automatic management failed; ask /manage-trade again`
        this.active = null
      } else if (!chat.busy && chat.outcome === "succeeded") {
        const { request, previousMessages } = this.active
        const response = chat.messages.some(message => message.role === "assistant" && !previousMessages.has(message.id) && message.text.trim())
        this.active = null
        if (response && this.trades.get(request.key) === request.trade) {
          const symbol = request.trade.position.symbol
          this.state.lastReminder = { symbol, at: new Date(this.now()).toISOString() }
          this.alert(symbol)
        } else if (!response) this.state.error = "Automatic management returned no response; ask /manage-trade again"
      }
    }
    this.queue = this.queue.filter(request => this.trades.get(request.key) === request.trade)
    this.publish()
    if (!this.state.enabled || this.sending || this.active || !this.queue.length || !this.chat.snapshot.connected || this.chat.snapshot.busy) return
    const request = this.queue.shift()!
    this.active = { request, previousMessages: new Set(this.chat.snapshot.messages.map(message => message.id)) }
    this.sending = true
    const generation = this.generation
    this.publish()
    void this.deliver(request, generation).finally(() => { this.sending = false; this.publish() })
  }
  private async deliver(request: Request, generation: number): Promise<void> {
    try {
      const text = await this.prepare(request.trade.position.positionId)
      this.observe()
      if (generation !== this.generation || this.trades.get(request.key) !== request.trade) { this.active = null; return }
      await this.chat.sendAutomatic(text, request.id)
    } catch (error) {
      if (generation !== this.generation) return
      this.active = null
      this.state.error = `${request.trade.position.symbol}: ${error instanceof Error ? error.message : "automatic management unavailable"}. Ask /manage-trade again`
    }
  }
  private observe(): void {
    const snapshot = this.engine.getSnapshot()
    const facts = snapshot.brokerFacts
    const at = facts ? Date.parse(facts.asOf) : NaN
    const age = this.now() - at
    if (!facts || snapshot.broker.state !== "connected" || facts.source.state !== "connected" || !Number.isFinite(age) || age < 0 || age > 60_000) return
    const held = new Set<string>()
    for (const position of facts.positions.filter(position => position.quantity > 0)) {
      const key = JSON.stringify([facts.accountId, position.positionId, position.symbol, position.side])
      held.add(key)
      let trade = this.trades.get(key)
      if (!trade) {
        trade = { position, initial: position.quantity, since: at, fills: new Set(facts.recentFills.map(fill => fill.fillId)), added: 0, exited: 0, triggered: false }
        this.trades.set(key, trade)
        continue
      }
      // Late fills wait for account quantities to catch up; duplicate fill IDs cannot count twice.
      for (const fill of facts.recentFills) {
        const filledAt = Date.parse(fill.filledAt)
        if (fill.symbol !== position.symbol || trade.fills.has(fill.fillId) || !Number.isFinite(filledAt) || filledAt <= trade.since || filledAt > at || !Number.isFinite(fill.quantity) || fill.quantity <= 0) continue
        trade.fills.add(fill.fillId)
        if (fill.side === (position.side === "long" ? "sell" : "buy")) trade.exited += fill.quantity
        else trade.added += fill.quantity
      }
      trade.position = position
      const size = trade.initial + trade.added
      const threshold = Math.max(1, Math.floor(size * .3))
      const reconciled = Math.abs(size - trade.exited - position.quantity) < 1e-8
      if (this.state.enabled && !trade.triggered && reconciled && trade.exited >= threshold) {
        trade.triggered = true
        this.queue.push({ key, trade, id: `cairo-partial-${randomUUID()}` })
        this.state.error = null
      }
    }
    for (const key of this.trades.keys()) if (!held.has(key)) this.trades.delete(key)
  }
  private publish(): void {
    this.state.pending = this.queue.length
    this.state.activeSymbol = this.active?.request.trade.position.symbol ?? null
    if (JSON.stringify(this.engine.getSnapshot().copilotPartialManagement) !== JSON.stringify(this.state)) this.engine.updateSnapshot({ copilotPartialManagement: structuredClone(this.state) })
  }
}
