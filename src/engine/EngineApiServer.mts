import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { randomBytes } from "node:crypto"
import type { ChartSnapshot, EngineEvent } from "../shared/contracts.mts"
import { CairoEngine } from "./CairoEngine.mts"
import { PreparationConflictError, PreparationStore, PreparationValidationError } from "./PreparationStore.mts"

const MAX_EVENT_CLIENTS = 16
const HEARTBEAT_MS = 15_000

interface EventClient {
  response: ServerResponse
  unsubscribe: () => void
  heartbeat: ReturnType<typeof setInterval>
}

export class EngineApiServer {
  private server: Server | undefined
  private clients = new Set<EventClient>()
  private starting: Promise<string> | undefined
  private readonly engine: CairoEngine
  private preparationStore: PreparationStore | undefined
  private preparationOperation: Promise<unknown> = Promise.resolve()
  private chartRefresher: ((symbol: string, date: string) => Promise<{ ok: boolean; snapshot: ChartSnapshot | null; error?: string }>) | undefined
  private brokerRefresher: (() => Promise<{ status: import("../shared/contracts.mts").SourceStatus; error: string | null }>) | undefined
  readonly commandToken = randomBytes(32).toString("hex")

  constructor(engine: CairoEngine) { this.engine = engine }

  setPreparationStore(store: PreparationStore): void { this.preparationStore = store }

  async loadPreparation(): Promise<boolean> {
    if (!this.preparationStore) return false
    return this.serialPreparation(async () => {
      try {
        const preparation = await this.preparationStore!.load()
        this.engine.updateSnapshot({ preparation, preparationError: null })
        return true
      } catch {
        this.engine.updateSnapshot({ preparationError: "Saved preparation could not be read. Resolve the file issue before saving." })
        return false
      }
    })
  }

  private serialPreparation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.preparationOperation.catch(() => undefined).then(operation)
    this.preparationOperation = next
    return next
  }

  setChartRefresher(refresher: (symbol: string, date: string) => Promise<{ ok: boolean; snapshot: ChartSnapshot | null; error?: string }>): void {
    this.chartRefresher = refresher
  }

  setBrokerRefresher(refresher: () => Promise<{ status: import("../shared/contracts.mts").SourceStatus; error: string | null }>): void {
    this.brokerRefresher = refresher
  }

  get isListening(): boolean { return this.server?.listening === true }

  async start(): Promise<string> {
    if (this.server?.listening) return this.baseUrl()
    if (this.starting) return this.starting
    this.server = createServer((request, response) => this.handle(request, response))
    this.starting = new Promise((resolve, reject) => {
      const server = this.server!
      const onError = (error: Error) => {
        server.off("listening", onListening)
        this.starting = undefined
        reject(error)
      }
      const onListening = () => {
        server.off("error", onError)
        this.starting = undefined
        resolve(this.baseUrl())
      }
      server.once("error", onError)
      server.once("listening", onListening)
      server.listen(0, "127.0.0.1")
    })
    return this.starting
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = undefined
    for (const client of [...this.clients]) {
      clearInterval(client.heartbeat)
      client.unsubscribe()
      client.response.end()
      this.clients.delete(client)
    }
    if (!server.listening) return
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  private baseUrl(): string {
    const address = this.server?.address()
    if (!address || typeof address === "string") throw new Error("Engine API server has no TCP address")
    return `http://127.0.0.1:${address.port}`
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID")
    response.setHeader("X-Content-Type-Options", "nosniff")
    if (request.method === "OPTIONS") {
      response.writeHead(204).end()
      return
    }
    const base = this.baseUrl()
    const url = new URL(request.url ?? "/", base)
    if (url.pathname === "/preparation" && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      if (!this.preparationStore) { this.json(response, 503, { error: "preparation-store-unavailable" }); return }
      void this.savePreparation(request, response)
      return
    }
    if (url.pathname === "/preparation" && request.method === "GET") {
      if (!this.preparationStore) { this.json(response, 503, { error: "preparation-store-unavailable" }); return }
      void this.loadPreparation().then((ok) => this.json(response, ok ? 200 : 503, {
        preparation: this.engine.getSnapshot().preparation,
        error: this.engine.getSnapshot().preparationError,
      }))
      return
    }
    if (request.method === "POST" && url.pathname === "/chart/refresh") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) {
        this.json(response, 403, { error: "forbidden" })
        return
      }
      if (!this.chartRefresher) {
        this.json(response, 503, { error: "chart-source-unavailable" })
        return
      }
      void this.refreshChart(request, response)
      return
    }
    if (request.method === "POST" && url.pathname === "/broker/refresh") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      if (!this.brokerRefresher) { this.json(response, 503, { error: "broker-source-unavailable" }); return }
      void this.refreshBroker(response)
      return
    }
    if (request.method !== "GET") {
      this.json(response, 405, { error: "method-not-allowed" })
      return
    }

    if (url.pathname === "/health") {
      const snapshot = this.engine.getSnapshot()
      this.json(response, 200, {
        ok: this.isListening,
        mode: this.engine.mode,
        runtimeInstanceId: snapshot.runtimeInstanceId,
        sequence: snapshot.sequence,
      })
      return
    }
    if (url.pathname === "/snapshot") {
      this.json(response, 200, this.engine.getSnapshot())
      return
    }
    if (url.pathname === "/events") {
      this.events(request, response, url)
      return
    }
    this.json(response, 404, { error: "not-found" })
  }

  private async refreshBroker(response: ServerResponse): Promise<void> {
    try {
      const result = await this.brokerRefresher!()
      if (response.destroyed) return
      this.json(response, result.error ? 503 : 200, { ok: !result.error, status: result.status })
    } catch {
      this.json(response, 502, { error: "broker-refresh-failed" })
    }
  }

  private async savePreparation(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 512 * 1024) { this.json(response, 413, { error: "request-too-large" }); return }
        chunks.push(buffer)
      }
      let value: unknown
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")) }
      catch { this.json(response, 400, { error: "Notes request must be valid JSON" }); return }
      if (!value || typeof value !== "object" || Array.isArray(value)) { this.json(response, 400, { error: "invalid-request" }); return }
      const { content, expectedRevision } = value as Record<string, unknown>
      const preparation = await this.serialPreparation(async () => {
        const saved = await this.preparationStore!.save(content, expectedRevision)
        this.engine.updateSnapshot({ preparation: saved, preparationError: null })
        return saved
      })
      this.json(response, 200, { preparation })
    } catch (error) {
      if (error instanceof PreparationConflictError) { this.json(response, 409, { error: error.message }); return }
      if (error instanceof PreparationValidationError) { this.json(response, 400, { error: error.message }); return }
      this.json(response, 503, { error: "Preparation could not be saved. Your edits are still in the editor." })
    }
  }

  private async refreshChart(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 4096) { this.json(response, 413, { error: "request-too-large" }); return }
        chunks.push(buffer)
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      if (!value || typeof value !== "object" || Array.isArray(value)) { this.json(response, 400, { error: "invalid-request" }); return }
      const { symbol, date } = value as Record<string, unknown>
      if (typeof symbol !== "string" || typeof date !== "string") { this.json(response, 400, { error: "expected-symbol-and-date" }); return }
      const result = await this.chartRefresher!(symbol, date)
      if (response.destroyed) return
      if (result.snapshot) {
        const chart = result.ok ? result.snapshot : {
          ...result.snapshot,
          source: { ...result.snapshot.source, state: "stale" as const, updatedAt: new Date().toISOString(), detail: result.error ?? "Refresh failed; showing prior snapshot" },
        }
        this.engine.updateSnapshot({ chart })
      } else if (!result.ok) {
        const current = this.engine.getSnapshot().chart
        if (current) this.engine.updateSnapshot({ chart: {
          ...current,
          source: { ...current.source, state: "stale", updatedAt: new Date().toISOString(), detail: result.error ?? "Refresh failed; showing prior snapshot" },
        } })
      }
      this.json(response, result.ok ? 200 : 502, { ok: result.ok, snapshot: result.snapshot, error: result.error ?? null })
    } catch {
      this.json(response, 400, { error: "invalid-chart-refresh" })
    }
  }

  private events(request: IncomingMessage, response: ServerResponse, url: URL): void {
    if (this.clients.size >= MAX_EVENT_CLIENTS) {
      this.json(response, 503, { error: "event-client-limit" })
      return
    }
    const instance = url.searchParams.get("instance")
    const afterText = url.searchParams.get("after")
    const after = afterText === null ? Number.NaN : Number(afterText)
    if (!instance || !Number.isSafeInteger(after) || after < 0) {
      this.json(response, 400, { error: "expected-instance-and-nonnegative-after-sequence" })
      return
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    })
    response.flushHeaders()

    const subscription = this.engine.subscribeFrom(instance, after, (event) => this.writeEvent(response, event))
    if (subscription.resyncRequired) {
      const snapshot = this.engine.getSnapshot()
      response.write(`event: resync\ndata: ${JSON.stringify({ reason: subscription.reason, runtimeInstanceId: snapshot.runtimeInstanceId, sequence: snapshot.sequence })}\n\n`)
      response.end()
      return
    }

    const client: EventClient = {
      response,
      unsubscribe: subscription.unsubscribe,
      heartbeat: setInterval(() => response.write(": keep-alive\n\n"), HEARTBEAT_MS),
    }
    this.clients.add(client)
    const cleanup = () => {
      clearInterval(client.heartbeat)
      client.unsubscribe()
      this.clients.delete(client)
    }
    request.socket.once("close", cleanup)
    response.once("close", cleanup)
  }

  private writeEvent(response: ServerResponse, event: EngineEvent): void {
    response.write(`id: ${event.runtimeInstanceId}:${event.sequence}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`)
  }

  private json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    })
    response.end(JSON.stringify(value))
  }
}
