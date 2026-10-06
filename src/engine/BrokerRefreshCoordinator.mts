import { createHash } from "node:crypto"
import type { BrokerFacts, SourceStatus } from "../shared/contracts.mts"
import { CairoEngine } from "./CairoEngine.mts"
import type { SchwabAccountReader } from "./SchwabAccountReader.mts"
import type { SchwabOrderReader } from "./SchwabOrderReader.mts"

export interface BrokerRefreshResult {
  refreshSequence: number
  factsRevision: number
  facts: BrokerFacts | null
  status: SourceStatus
  error: string | null
}

export class BrokerRefreshCoordinator {
  private readonly engine: CairoEngine
  private readonly accountReader: SchwabAccountReader
  private readonly orderReader: SchwabOrderReader
  private readonly now: () => number
  private readonly onRefresh: () => void
  private pending: Promise<BrokerRefreshResult> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private started = false
  private activityPending = false
  private activityTimer = false
  private refreshSequence = 0
  private factsRevision = 0
  private lastFingerprint: string | null = null
  private lastFacts: BrokerFacts | null = null

  constructor(engine: CairoEngine, accountReader: SchwabAccountReader, orderReader: SchwabOrderReader, options: { now?: () => number; onRefresh?: () => void } = {}) {
    this.engine = engine
    this.accountReader = accountReader
    this.orderReader = orderReader
    this.now = options.now ?? Date.now
    this.onRefresh = options.onRefresh ?? (() => {})
  }

  get isStarted(): boolean { return this.started }
  get inFlight(): boolean { return this.pending !== undefined }

  start(): void {
    if (this.started) return
    this.started = true
    this.schedule(0)
  }

  async stop(): Promise<void> {
    this.started = false
    this.activityPending = false
    this.activityTimer = false
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await this.pending
  }

  /** Coalesce bursts, but never lose an activity received during an older REST read. */
  accountActivity(): void {
    if (!this.started) return
    if (this.pending) { this.activityPending = true; return }
    if (this.activityTimer) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.activityTimer = true
    this.schedule(100)
  }

  refresh(): Promise<BrokerRefreshResult> {
    if (this.pending) return this.pending
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.activityTimer = false
    const sequence = ++this.refreshSequence
    const pending = this.runRefresh(sequence).catch((error) => this.publishFailure(sequence, error instanceof Error ? error.message : "Schwab refresh failed"))
    this.pending = pending
    void pending.finally(() => {
      if (this.pending === pending) this.pending = undefined
      const followUp = this.activityPending
      this.activityPending = false
      if (this.started && followUp) this.schedule(100)
      if (this.started) this.onRefresh()
    })
    return pending
  }

  private async runRefresh(sequence: number): Promise<BrokerRefreshResult> {
    const accountResult = await this.accountReader.readSelectedAccount()
    if (!accountResult.facts) return this.publishFailure(sequence, accountResult.error ?? accountResult.status.detail ?? "Schwab account is unavailable", accountResult.status)

    let facts = accountResult.facts
    let orderError: string | null = null
    try {
      const orders = await this.orderReader.readSelectedAccountOrders()
      if (orders.accountId !== facts.accountId) throw new Error("Selected Schwab account changed during refresh")
      facts = {
        ...facts,
        workingOrders: orders.error && !orders.workingOrders.length && this.lastFacts?.accountId === facts.accountId ? this.lastFacts.workingOrders : orders.workingOrders,
        recentFills: orders.error && !orders.recentFills.length && this.lastFacts?.accountId === facts.accountId ? this.lastFacts.recentFills : orders.recentFills,
        ordersComplete: orders.ordersComplete,
      }
      orderError = orders.error
    } catch (error) {
      orderError = error instanceof Error ? error.message : "Schwab order refresh failed"
      facts = {
        ...facts,
        workingOrders: this.lastFacts?.accountId === facts.accountId ? this.lastFacts.workingOrders : [],
        recentFills: this.lastFacts?.accountId === facts.accountId ? this.lastFacts.recentFills : [],
        ordersComplete: false,
      }
    }
    const status: SourceStatus = {
      source: "broker",
      state: facts.ordersComplete ? "connected" : "stale",
      updatedAt: new Date(this.now()).toISOString(),
      detail: facts.ordersComplete ? "Schwab account and order snapshot current" : orderError ?? "Schwab order coverage is incomplete",
    }
    facts = { ...facts, source: status }
    this.publishFacts(facts, sequence)
    return { refreshSequence: sequence, factsRevision: this.factsRevision, facts: structuredClone(facts), status, error: orderError }
  }

  private publishFailure(sequence: number, error: string, suppliedStatus?: SourceStatus): BrokerRefreshResult {
    const status: SourceStatus = suppliedStatus ?? { source: "broker", state: "stale", updatedAt: new Date(this.now()).toISOString(), detail: safeError(error) }
    this.engine.updateSnapshot({ broker: status, brokerRefreshSequence: sequence })
    return { refreshSequence: sequence, factsRevision: this.factsRevision, facts: this.lastFacts ? structuredClone(this.lastFacts) : null, status, error: safeError(error) }
  }

  private publishFacts(facts: BrokerFacts, sequence: number): void {
    const fingerprint = hashFacts(facts)
    if (fingerprint !== this.lastFingerprint) {
      this.lastFingerprint = fingerprint
      this.factsRevision++
    }
    this.lastFacts = structuredClone(facts)
    this.engine.updateSnapshot({
      broker: facts.source,
      brokerFacts: facts,
      positions: facts.positions,
      brokerFactsRevision: this.factsRevision,
      brokerRefreshSequence: sequence,
    })
  }

  private schedule(delay: number): void {
    if (!this.started || this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.activityTimer = false
      void this.refresh()
    }, delay)
  }
}

function hashFacts(facts: BrokerFacts): string {
  const positions = [...facts.positions].map(({ markUpdatedAt: _at, markSource: _source, ...position }) => position).sort((a, b) => a.positionId.localeCompare(b.positionId))
  const orders = [...facts.workingOrders].sort((a, b) => `${a.orderId}:${a.symbol}`.localeCompare(`${b.orderId}:${b.symbol}`))
  const fills = [...facts.recentFills].sort((a, b) => a.fillId.localeCompare(b.fillId))
  return createHash("sha256").update(JSON.stringify({ accountId: facts.accountId, positions, orders, fills, ordersComplete: facts.ordersComplete, accountAvailability: facts.accountAvailability ? { liquidationValue: facts.accountAvailability.liquidationValue, buyingPower: facts.accountAvailability.buyingPower } : undefined })).digest("hex")
}

function safeError(message: string): string { return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240) }

