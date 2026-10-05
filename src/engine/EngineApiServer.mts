import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { EngineEvent } from "../shared/contracts.mts"
import { CairoEngine } from "./CairoEngine.mts"

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

  constructor(engine: CairoEngine) { this.engine = engine }

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
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")
    response.setHeader("X-Content-Type-Options", "nosniff")
    if (request.method === "OPTIONS") {
      response.writeHead(204).end()
      return
    }
    if (request.method !== "GET") {
      this.json(response, 405, { error: "method-not-allowed" })
      return
    }

    const base = this.baseUrl()
    const url = new URL(request.url ?? "/", base)
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
