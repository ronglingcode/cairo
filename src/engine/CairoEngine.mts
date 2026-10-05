import type { CairoSnapshot, Clock, EngineEvent, SourceStatus } from "../shared/contracts.mts"

const MAX_POSITIONS = 500
const MAX_TRADEBOOKS = 100
const MAX_ATTACHMENTS = 500
const MAX_TICKETS = 200
const MAX_BROKER_ORDERS = 1_000
const MAX_BROKER_FILLS = 1_000
const MAX_EVENTS = 128

export type EngineEventListener = (event: EngineEvent) => void

export type EngineSubscription =
  | { resyncRequired: false; unsubscribe: () => void }
  | { resyncRequired: true; reason: "runtime-changed" | "event-gap" | "cursor-ahead" }

export interface EngineOptions {
  clock?: Clock
  cycleIntervalMs?: number
  runCycle?: (engine: CairoEngine) => Promise<void>
}

export class CairoEngine {
  readonly runtimeInstanceId: string
  readonly mode = "observer" as const
  readonly canSubmitOrders = false as const
  private readonly clock: Clock
  private readonly cycleIntervalMs: number
  private readonly runCycle: (engine: CairoEngine) => Promise<void>
  private snapshot: CairoSnapshot
  private started = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private pendingCycle: Promise<void> | undefined
  private events: EngineEvent[] = []
  private listeners = new Set<EngineEventListener>()

  constructor(options: EngineOptions = {}) {
    this.runtimeInstanceId = globalThis.crypto.randomUUID()
    this.clock = options.clock ?? { now: () => Date.now() }
    this.cycleIntervalMs = options.cycleIntervalMs ?? 1_000
    if (!Number.isFinite(this.cycleIntervalMs) || this.cycleIntervalMs < 10) {
      throw new RangeError("cycleIntervalMs must be a finite number of at least 10")
    }
    this.runCycle = options.runCycle ?? (async () => undefined)
    this.snapshot = {
      runtimeInstanceId: this.runtimeInstanceId,
      sequence: 0,
      brokerFactsRevision: 0,
      brokerRefreshSequence: 0,
      chart: null,
      bookmap: this.waiting("bookmap", "Observation source has not started"),
      broker: this.waiting("broker", "Broker source has not started"),
      brokerFacts: null,
      copilot: this.waiting("copilot", "Copilot has not started"),
      positions: [],
      tradebooks: [],
      attachments: [],
      tickets: [],
    }
  }

  get isStarted(): boolean { return this.started }

  start(): void {
    if (this.started) return
    this.started = true
    this.scheduleCycle(0)
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await this.pendingCycle
  }

  getSnapshot(): CairoSnapshot {
    return structuredClone(this.snapshot)
  }

  updateSnapshot(update: Partial<Omit<CairoSnapshot, "runtimeInstanceId" | "sequence">>): CairoSnapshot {
    const cloned = structuredClone(update)
    const changes = {
      ...cloned,
      ...(cloned.brokerFacts === undefined || cloned.brokerFacts === null ? {} : {
        brokerFacts: {
          ...cloned.brokerFacts,
          positions: cloned.brokerFacts.positions.slice(-MAX_POSITIONS),
          workingOrders: cloned.brokerFacts.workingOrders.slice(-MAX_BROKER_ORDERS),
          recentFills: cloned.brokerFacts.recentFills.slice(-MAX_BROKER_FILLS),
        },
      }),
      ...(cloned.positions === undefined ? {} : { positions: cloned.positions.slice(-MAX_POSITIONS) }),
      ...(cloned.tradebooks === undefined ? {} : { tradebooks: cloned.tradebooks.slice(-MAX_TRADEBOOKS) }),
      ...(cloned.attachments === undefined ? {} : { attachments: cloned.attachments.slice(-MAX_ATTACHMENTS) }),
      ...(cloned.tickets === undefined ? {} : { tickets: cloned.tickets.slice(-MAX_TICKETS) }),
    }
    this.snapshot = {
      ...this.snapshot,
      ...changes,
      runtimeInstanceId: this.runtimeInstanceId,
      sequence: this.snapshot.sequence + 1,
      positions: changes.positions === undefined ? this.snapshot.positions : changes.positions,
      tradebooks: changes.tradebooks === undefined ? this.snapshot.tradebooks : changes.tradebooks,
      attachments: changes.attachments === undefined ? this.snapshot.attachments : changes.attachments,
      tickets: changes.tickets === undefined ? this.snapshot.tickets : changes.tickets,
    }
    const event: EngineEvent = {
      runtimeInstanceId: this.runtimeInstanceId,
      sequence: this.snapshot.sequence,
      changes,
    }
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    for (const listener of [...this.listeners]) {
      try {
        listener(structuredClone(event))
      } catch {
        this.listeners.delete(listener)
      }
    }
    return this.getSnapshot()
  }

  subscribeFrom(runtimeInstanceId: string, sequence: number, listener: EngineEventListener): EngineSubscription {
    if (runtimeInstanceId !== this.runtimeInstanceId) return { resyncRequired: true, reason: "runtime-changed" }
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > this.snapshot.sequence) {
      return { resyncRequired: true, reason: "cursor-ahead" }
    }
    const firstAvailable = this.events[0]?.sequence ?? this.snapshot.sequence + 1
    if (sequence < firstAvailable - 1) return { resyncRequired: true, reason: "event-gap" }

    for (const event of this.events) {
      if (event.sequence > sequence) listener(structuredClone(event))
    }
    this.listeners.add(listener)
    let active = true
    return {
      resyncRequired: false,
      unsubscribe: () => {
        if (!active) return
        active = false
        this.listeners.delete(listener)
      },
    }
  }

  get listenerCount(): number { return this.listeners.size }

  private waiting(source: SourceStatus["source"], detail: string): SourceStatus {
    return { source, state: "waiting", updatedAt: new Date(this.clock.now()).toISOString(), detail }
  }

  private scheduleCycle(delay: number): void {
    if (!this.started) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const pending = Promise.resolve().then(() => this.runCycle(this)).catch(() => undefined)
      this.pendingCycle = pending
      void pending.finally(() => {
        if (this.pendingCycle === pending) this.pendingCycle = undefined
        this.scheduleCycle(this.cycleIntervalMs)
      })
    }, delay)
  }
}
