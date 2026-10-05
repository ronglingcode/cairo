import type { CairoSnapshot, EngineEvent } from "../shared/contracts.mts"

export type RendererConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected"

interface JsonResponsePort {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

interface EventSourcePort {
  onopen: (() => void) | null
  onerror: (() => void) | null
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void
  close(): void
}

export interface EngineTransport {
  fetch(url: string, init: { signal: AbortSignal }): Promise<JsonResponsePort>
  eventSource(url: string): EventSourcePort
}

export interface EngineConnectionHandlers {
  onSnapshot(snapshot: CairoSnapshot): void
  onState(state: RendererConnectionState): void
}

function validSnapshot(value: unknown): value is CairoSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.runtimeInstanceId === "string" && item.runtimeInstanceId.length > 0 &&
    typeof item.sequence === "number" && Number.isSafeInteger(item.sequence) && item.sequence >= 0 &&
    typeof item.brokerFactsRevision === "number" && Number.isSafeInteger(item.brokerFactsRevision) && item.brokerFactsRevision >= 0 &&
    typeof item.brokerRefreshSequence === "number" && Number.isSafeInteger(item.brokerRefreshSequence) && item.brokerRefreshSequence >= 0 &&
    Array.isArray(item.positions) && Array.isArray(item.tradebooks) && Array.isArray(item.attachments) && Array.isArray(item.tickets) &&
    item.bookmap !== null && typeof item.bookmap === "object" &&
    item.broker !== null && typeof item.broker === "object" &&
    (item.brokerFacts === null || (item.brokerFacts !== null && typeof item.brokerFacts === "object")) &&
    item.copilot !== null && typeof item.copilot === "object"
}

function validEvent(value: unknown): value is EngineEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.runtimeInstanceId === "string" && typeof item.sequence === "number" &&
    Number.isSafeInteger(item.sequence) && item.sequence > 0 && item.changes !== null &&
    typeof item.changes === "object" && !Array.isArray(item.changes)
}

export class EngineConnection {
  private active = false
  private generation = 0
  private controller: AbortController | undefined
  private source: EventSourcePort | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retryDelay = 500
  private snapshot: CairoSnapshot | undefined
  private readonly transport: EngineTransport
  private readonly apiBaseUrl: string
  private readonly handlers: EngineConnectionHandlers

  constructor(
    apiBaseUrl: string,
    handlers: EngineConnectionHandlers,
    transport?: EngineTransport,
  ) {
    this.apiBaseUrl = apiBaseUrl
    this.handlers = handlers
    this.transport = transport ?? {
      fetch: (url, init) => fetch(url, init),
      eventSource: (url) => new EventSource(url) as unknown as EventSourcePort,
    }
  }

  connect(): Promise<void> {
    if (this.active) return Promise.resolve()
    this.active = true
    return this.refresh()
  }

  async refresh(): Promise<void> {
    if (!this.active) return
    const generation = ++this.generation
    this.source?.close()
    this.source = undefined
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.setState("connecting")

    try {
      const response = await this.transport.fetch(`${this.apiBaseUrl}/snapshot`, { signal: controller.signal })
      if (!response.ok) throw new Error(`snapshot request failed: ${response.status}`)
      const value = await response.json()
      if (!this.active || generation !== this.generation) return
      if (!validSnapshot(value)) throw new Error("invalid snapshot response")
      this.snapshot = value
      this.handlers.onSnapshot(structuredClone(value))
      this.retryDelay = 500
      this.openEvents(value, generation)
    } catch {
      if (!this.active || generation !== this.generation || controller.signal.aborted) return
      this.setState("disconnected")
      this.scheduleRetry()
    }
  }

  close(): void {
    this.active = false
    this.generation++
    this.controller?.abort()
    this.controller = undefined
    this.source?.close()
    this.source = undefined
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  private openEvents(snapshot: CairoSnapshot, generation: number): void {
    const url = new URL(`${this.apiBaseUrl}/events`)
    url.searchParams.set("instance", snapshot.runtimeInstanceId)
    url.searchParams.set("after", String(snapshot.sequence))
    const source = this.transport.eventSource(url.toString())
    this.source = source
    source.onopen = () => {
      if (this.active && generation === this.generation) {
        if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
        this.retryTimer = undefined
        this.retryDelay = 500
        this.setState("connected")
      }
    }
    source.onerror = () => {
      if (this.active && generation === this.generation) {
        this.setState("reconnecting")
        this.scheduleRetry()
      }
    }
    source.addEventListener("update", (raw) => this.onUpdate(raw, generation))
    source.addEventListener("resync", () => {
      if (this.active && generation === this.generation) void this.refresh()
    })
  }

  private onUpdate(raw: MessageEvent<string>, generation: number): void {
    if (!this.active || generation !== this.generation || !this.snapshot) return
    let parsed: unknown
    try { parsed = JSON.parse(raw.data) } catch { void this.refresh(); return }
    if (!validEvent(parsed)) { void this.refresh(); return }
    if (parsed.runtimeInstanceId !== this.snapshot.runtimeInstanceId) { void this.refresh(); return }
    if (parsed.sequence <= this.snapshot.sequence) return
    if (parsed.sequence !== this.snapshot.sequence + 1) { void this.refresh(); return }

    this.snapshot = {
      ...this.snapshot,
      ...structuredClone(parsed.changes),
      runtimeInstanceId: parsed.runtimeInstanceId,
      sequence: parsed.sequence,
    }
    this.handlers.onSnapshot(structuredClone(this.snapshot))
  }

  private scheduleRetry(): void {
    if (!this.active || this.retryTimer !== undefined) return
    const delay = this.retryDelay
    this.retryDelay = Math.min(this.retryDelay * 2, 10_000)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.refresh()
    }, delay)
  }

  private setState(state: RendererConnectionState): void {
    this.handlers.onState(state)
  }
}
