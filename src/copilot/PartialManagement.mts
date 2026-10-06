import { randomUUID } from "node:crypto"
import type { CairoEngine } from "../engine/CairoEngine.mts"
import type { BrokerPosition, CopilotChat } from "../shared/contracts.mts"
import { ManagementContextRequired } from "../engine/BookmapPatterns.mts"

export interface PartialManagementStatus {
  enabled: boolean
  pending: number
  activeSymbol: string | null
  lastReminder: { symbol: string; at: string } | null
  error: string | null
  notice?: { text: string; at: string; positionId?: string }
  waitingForPattern?: string[]
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
  private waiting: Array<Request & { tagRevision: string | null }> = []
  private active: { request: Request; previousMessages: Set<string> } | null = null
  private sending = false
  private generation = 0
  private engine: CairoEngine
  private chat: ManagementChat
  private prepare: (positionId: string) => Promise<string>
  private alert: (symbol: string, needsContext?: boolean) => void
  private now: () => number
  private openPattern?: (positionId: string) => Promise<void>
  private state: PartialManagementStatus = { enabled: true, pending: 0, activeSymbol: null, lastReminder: null, error: null }
  constructor(
    engine: CairoEngine,
    chat: ManagementChat,
    prepare: (positionId: string) => Promise<string>,
    alert: (symbol: string, needsContext?: boolean) => void,
    now: () => number = Date.now,
    openPattern?: (positionId: string) => Promise<void>,
  ) { this.engine = engine; this.chat = chat; this.prepare = prepare; this.alert = alert; this.now = now; this.openPattern = openPattern; this.observe(); this.publish() }

  async requestPattern(positionId: unknown): Promise<void> {
    this.observe()
    if (!this.state.enabled || !this.openPattern || !this.waiting.some(request => request.trade.position.positionId === positionId && this.trades.get(request.key) === request.trade)) throw new Error("This trade is no longer waiting for a pattern")
    await this.openPattern(positionId as string)
  }

  get ownsAutomaticChat(): boolean { return this.sending || Boolean(this.active) || this.queue.length > 0 }
  setEnabled(enabled: boolean): void {
    if (typeof enabled !== "boolean") throw new Error("Explicit partial reminder choice required")
    this.state.enabled = enabled
    this.state.error = null
    this.generation++
    this.queue = []
    this.waiting = []
    if (this.state.notice) this.state.lastReminder = null
    this.state.notice = undefined
    this.active = null
    this.publish()
  }
  cycle(): void {
    this.observe()
    this.waiting = this.waiting.filter(request => this.trades.get(request.key) === request.trade)
    if (this.state.notice?.positionId && !this.waiting.some(request => request.trade.position.positionId === this.state.notice?.positionId)) this.state.notice = undefined
    for (const request of [...this.waiting]) {
      const tag = this.engine.getSnapshot().bookmapPatternTags.find(tag => tag.accountId === JSON.parse(request.key)[0] && tag.positionId === request.trade.position.positionId && tag.side === request.trade.position.side)
      if (this.state.enabled && tag?.active && tag.runtimeInstanceId === this.engine.runtimeInstanceId && tag.revision !== request.tagRevision) {
        this.waiting = this.waiting.filter(item => item !== request)
        this.queue.push(request)
        if (this.state.notice?.positionId === request.trade.position.positionId) this.state.notice = undefined
      }
    }
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
      if (generation !== this.generation) { this.active = null; return }
      const text = await this.prepare(request.trade.position.positionId)
      this.observe()
      if (generation !== this.generation || this.trades.get(request.key) !== request.trade) { this.active = null; return }
      await this.chat.sendAutomatic(text, request.id)
    } catch (error) {
      if (generation !== this.generation) return
      this.active = null
      if (error instanceof ManagementContextRequired) {
        this.observe()
        if (this.trades.get(request.key) !== request.trade) return
        const at = new Date(this.now()).toISOString()
        const tag = this.engine.getSnapshot().bookmapPatternTags.find(tag => tag.accountId === JSON.parse(request.key)[0] && tag.positionId === request.trade.position.positionId && tag.side === request.trade.position.side)
        this.waiting.push({ ...request, tagRevision: tag?.revision ?? null })
        this.state.notice = { text: error.message, at, positionId: request.trade.position.positionId }
        this.state.lastReminder = { symbol: request.trade.position.symbol, at }
        this.state.error = null
        this.publish()
        this.alert(request.trade.position.symbol, true)
        return
      }
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
        this.state.notice = undefined
      }
    }
    for (const key of this.trades.keys()) if (!held.has(key)) this.trades.delete(key)
  }
  private publish(): void {
    this.state.pending = this.queue.length
    this.state.activeSymbol = this.active?.request.trade.position.symbol ?? null
    this.state.waitingForPattern = this.waiting.map(request => request.trade.position.symbol)
    if (JSON.stringify(this.engine.getSnapshot().copilotPartialManagement) !== JSON.stringify(this.state)) this.engine.updateSnapshot({ copilotPartialManagement: structuredClone(this.state) })
  }
}
