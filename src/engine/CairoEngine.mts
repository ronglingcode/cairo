import type { CairoSnapshot, Clock, SourceStatus } from "../shared/contracts.mts"

const MAX_POSITIONS = 500
const MAX_TRADEBOOKS = 100
const MAX_ATTACHMENTS = 500
const MAX_TICKETS = 200

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
      chart: null,
      bookmap: this.waiting("bookmap", "Observation source has not started"),
      broker: this.waiting("broker", "Broker source has not started"),
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
    this.snapshot = {
      ...this.snapshot,
      ...cloned,
      runtimeInstanceId: this.runtimeInstanceId,
      sequence: this.snapshot.sequence + 1,
      positions: cloned.positions === undefined ? this.snapshot.positions : cloned.positions.slice(-MAX_POSITIONS),
      tradebooks: cloned.tradebooks === undefined ? this.snapshot.tradebooks : cloned.tradebooks.slice(-MAX_TRADEBOOKS),
      attachments: cloned.attachments === undefined ? this.snapshot.attachments : cloned.attachments.slice(-MAX_ATTACHMENTS),
      tickets: cloned.tickets === undefined ? this.snapshot.tickets : cloned.tickets.slice(-MAX_TICKETS),
    }
    return this.getSnapshot()
  }

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
