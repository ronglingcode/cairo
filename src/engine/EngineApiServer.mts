import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { randomBytes } from "node:crypto"
import type { ChartSnapshot, EngineEvent } from "../shared/contracts.mts"
import { CairoEngine } from "./CairoEngine.mts"
import { PreparationConflictError, PreparationStore, PreparationValidationError } from "./PreparationStore.mts"
import type { CairoDomainTools } from "../copilot/CairoDomainTools.mts"
import type { CopilotChat } from "../copilot/CopilotChat.mts"
import type { PositionGuidance, AttachRequest } from "./PositionGuidance.mts"
import type { ManagementMonitor } from "./ManagementMonitor.mts"
import type { PolicyReview } from "./PolicyReview.mts"
import type { CopilotWaker } from "../copilot/CopilotWaker.mts"
import type { ExitTickets } from "./ExitTickets.mts"
import type { ExitIntent } from "./ExitEligibility.mts"
import type { ExitWriter } from "./ExitWriter.mts"
import type { UnknownReconciler } from "./UnknownReconciler.mts"
import type { TicketPermissions } from "../copilot/TicketPermissions.mts"

const MAX_EVENT_CLIENTS = 16
const HEARTBEAT_MS = 15_000

interface EventClient {
  response: ServerResponse
  unsubscribe: () => void
  heartbeat: ReturnType<typeof setInterval>
}

export class EngineApiServer {
  private bookmapPatterns?: import("./BookmapPatterns.mts").BookmapPatterns
  setBookmapPatterns(patterns: import("./BookmapPatterns.mts").BookmapPatterns): void { this.bookmapPatterns = patterns }
  private entryObserver?: import("./EntryObserver.mts").EntryObserver
  setEntryObserver(observer: import("./EntryObserver.mts").EntryObserver): void { this.entryObserver = observer }
  private server: Server | undefined
  private clients = new Set<EventClient>()
  private starting: Promise<string> | undefined
  private readonly engine: CairoEngine
  private preparationStore: PreparationStore | undefined
  private preparationOperation: Promise<unknown> = Promise.resolve()
  private copilotRestarter: (() => Promise<boolean>) | undefined
  private domainTools: CairoDomainTools | undefined
  private chat: CopilotChat | undefined
  private guidance: PositionGuidance | undefined
  private monitor: ManagementMonitor | undefined
  private policyReview: PolicyReview | undefined
  setPolicyReview(review: PolicyReview): void { this.policyReview = review }
  private waker: CopilotWaker | undefined
  setCopilotWaker(waker: CopilotWaker): void { this.waker = waker }
  private tickets: ExitTickets | undefined
  setExitTickets(tickets: ExitTickets): void { this.tickets = tickets }
  private writer: ExitWriter | undefined
  setExitWriter(writer: ExitWriter): void { this.writer = writer }
  private reconciler: UnknownReconciler | undefined
  setUnknownReconciler(reconciler: UnknownReconciler): void { this.reconciler = reconciler }
  private permissions: TicketPermissions | undefined
  setTicketPermissions(permissions: TicketPermissions): void { this.permissions = permissions }
  private chartRefresher: ((symbol: string, date: string) => Promise<{ ok: boolean; snapshot: ChartSnapshot | null; error?: string }>) | undefined
  private brokerRefresher: (() => Promise<{ status: import("../shared/contracts.mts").SourceStatus; error: string | null }>) | undefined
  readonly commandToken = randomBytes(32).toString("hex")
  readonly toolToken = randomBytes(32).toString("hex")

  constructor(engine: CairoEngine) { this.engine = engine }

  setPreparationStore(store: PreparationStore): void { this.preparationStore = store }
  setCopilotRestarter(restart: () => Promise<boolean>): void { this.copilotRestarter = restart }
  setDomainTools(tools: CairoDomainTools): void { this.domainTools = tools }
  setCopilotChat(chat: CopilotChat): void { this.chat = chat }
  setPositionGuidance(guidance: PositionGuidance): void { this.guidance = guidance }
  setManagementMonitor(monitor: ManagementMonitor): void { this.monitor = monitor }

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
    if (url.pathname === "/recovery/identity" && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      void this.readCommand(request).then(async value => { if (!this.reconciler) throw new Error("Reconciliation unavailable"); await this.reconciler.confirmIdentity(String(value.id), String(value.brokerOrderId), value.reviewed === true); this.json(response, 200, { ok: true }) }).catch(error => this.json(response, 400, { error: error instanceof Error ? error.message : "Identity review failed" })); return
    }
    if (["/tickets/stage", "/tickets/dismiss", "/tickets/approve"].includes(url.pathname) && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      void this.readCommand(request).then(async value => {
        if (!this.tickets) throw new Error("Exit staging unavailable")
        if (url.pathname === "/tickets/stage") this.json(response, 200, { ticket: this.tickets.stage(value as unknown as ExitIntent, "trader") })
        else if (url.pathname === "/tickets/approve") {
          if (this.permissions?.has(String(value.id))) {
            const result = await this.permissions.approve(String(value.id), String(value.expectedHash), async () => this.writer ? this.writer.submit(String(value.id), String(value.expectedHash)) : null)
            this.json(response, 200, result); return
          }
          const ticket = this.tickets.approve(String(value.id), String(value.expectedHash))
          const attempt = this.writer ? await this.writer.submit(ticket.id, String(value.expectedHash)) : null
          this.json(response, 200, { ticket, attempt, submitted: attempt !== null })
        }
        else { if (this.permissions?.has(String(value.id))) await this.permissions.reject(String(value.id)); else this.tickets.dismiss(String(value.id)); this.json(response, 200, { ok: true }) }
      }).catch(error => this.json(response, 400, { error: error instanceof Error ? error.message : "Ticket request failed" })); return
    }
    if (["/bookmap-pattern/select", "/bookmap-pattern/cancel"].includes(url.pathname) && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      void this.readCommand(request).then(async value => {
        if (!this.bookmapPatterns) throw new Error("Bookmap pattern selection unavailable")
        if (url.pathname === "/bookmap-pattern/cancel") this.bookmapPatterns.cancel(value.pickerId)
        else {
          if (this.chat?.snapshot.busy) throw new Error("Wait for the current reply before tagging")
          const selected = await this.bookmapPatterns.select(value)
          if (!selected.manual) {
            if (!this.chat) throw new Error("Pattern saved. Reconnect chat and invoke /set-stop-loss again.")
            await this.chat.send(selected.text, selected.commandId)
          }
        }
        this.json(response, 200, { ok: true })
      }).catch(error => {
        const detail = error instanceof Error ? error.message : "Pattern selection failed"
        if (!this.engine.getSnapshot().bookmapPatternPicker) this.engine.updateSnapshot({ bookmapPatternError: detail })
        this.json(response, 400, { error: detail })
      })
      return
    }
    if (url.pathname === "/copilot/events" && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      void this.readCommand(request).then(value => { if (!this.waker || typeof value.enabled !== "boolean") throw new Error("Event settings unavailable"); this.waker.setEnabled(value.enabled); this.json(response, 200, { ok: true }) }).catch(() => this.json(response, 400, { error: "Invalid event setting" })); return
    }
    if (["/proposals/accept", "/proposals/reject"].includes(url.pathname) && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      void this.reviewProposal(url.pathname, request, response); return
    }
      if (["/observation/activate", "/observation/deactivate"].includes(url.pathname) && request.method === "POST") {
        if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
        void this.readCommand(request).then(value => { if (!this.entryObserver) throw new Error("Observation unavailable"); if (url.pathname === "/observation/activate") this.entryObserver.activate(value as unknown as Parameters<import("./EntryObserver.mts").EntryObserver["activate"]>[0]); else this.entryObserver.deactivate(String(value.id)); this.json(response, 200, { ok: true }) }).catch(error => this.json(response, 400, { error: error instanceof Error ? error.message : "Invalid observation request" })); return
      }
      if (["/management/attach", "/management/pause", "/management/reconfirm", "/management/confirm", "/management/rearm"].includes(url.pathname) && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      if (!this.guidance) { this.json(response, 503, { error: "Guidance service unavailable" }); return }
      void this.managementCommand(url.pathname, request, response)
      return
    }
    if (url.pathname === "/copilot/skills" && request.method === "GET") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      if (!this.chat) { this.json(response, 503, { error: "Chat is unavailable" }); return }
      response.setHeader("Cache-Control", "no-store")
      void this.chat.listSkills().then(skills => this.json(response, 200, { skills })).catch(error => this.json(response, 400, { error: error instanceof Error ? error.message : "Skill library unavailable" }))
      return
    }
    if (["/copilot/send", "/copilot/cancel", "/copilot/connect"].includes(url.pathname) && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      if (!this.chat) { this.json(response, 503, { error: "Chat is unavailable" }); return }
      void this.chatCommand(url.pathname, request, response)
      return
    }
    if (url.pathname === "/copilot/tools" && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${this.toolToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      if (!this.domainTools) { this.json(response, 503, { error: "copilot-tools-unavailable" }); return }
      void this.executeDomainTool(request, response)
      return
    }
    if (url.pathname === "/copilot/restart" && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${this.commandToken}`) { this.json(response, 403, { error: "forbidden" }); return }
      if (!this.copilotRestarter) { this.json(response, 503, { error: "copilot-unavailable" }); return }
      void this.copilotRestarter().then(ok => this.json(response, ok ? 200 : 503, { ok })).catch(() => this.json(response, 503, { error: "Copilot could not restart" }))
      return
    }
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

  private async chatCommand(route: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (route === "/copilot/connect") await this.chat!.connect()
      else if (route === "/copilot/cancel") { const session = this.chat!.snapshot.sessionId; if (session) await this.domainTools?.cancelSession(session); await this.chat!.cancel() }
      else {
        const chunks: Buffer[] = []
        let bytes = 0
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.length
          if (bytes > 64 * 1024) { this.json(response, 413, { error: "Message is too large" }); return }
          chunks.push(buffer)
        }
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid message")
        if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 8000 || typeof value.commandId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(value.commandId)) throw new Error("Invalid message or command ID")
        if (this.chat!.snapshot.busy) throw new Error("Wait for the current reply before choosing a pattern")
        const prepared = await this.bookmapPatterns?.preflight(value.text, value.commandId)
        if (prepared?.picker) { this.json(response, 200, { patternSelectionRequired: true }); return }
        await this.chat!.send(prepared?.text ?? value.text, value.commandId)
      }
      this.json(response, 200, { chat: this.chat!.snapshot })
    } catch (error) { this.json(response, 400, { error: error instanceof Error ? error.message : "Chat request failed" }) }
  }
  private async readCommand(request: IncomingMessage, maximum = 128 * 1024): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []; let bytes = 0
    for await (const chunk of request) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += buffer.length; if (bytes > maximum) throw new Error("Request is too large"); chunks.push(buffer) }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid command")
    return value
  }
  private async managementCommand(route: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const value = await this.readCommand(request)
      if (route === "/management/attach") this.guidance!.attach(value as unknown as AttachRequest)
      if (route === "/management/pause") this.guidance!.pause(String(value.id), String(value.expectedRevision))
      if (route === "/management/reconfirm") this.guidance!.reconfirm(String(value.id), String(value.expectedRevision), Number(value.factsRevision), Number(value.initialQuantity), value.reviewed === true)
      if (route === "/management/confirm") { if (!this.monitor) throw new Error("Monitoring unavailable"); this.monitor.confirm(String(value.id), String(value.expectedRevision), Number(value.factsRevision), String(value.conditionId), value.value as boolean) }
      if (route === "/management/rearm") { if (!this.monitor) throw new Error("Monitoring unavailable"); this.monitor.rearm(String(value.id), String(value.expectedRevision), String(value.ruleId)) }
      this.json(response, 200, { ok: true })
    } catch (error) { this.json(response, 400, { error: error instanceof Error ? error.message : "Guidance request failed" }) }
  }
  private async reviewProposal(route: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const value = await this.readCommand(request); const id = String(value.id)
      if (value.kind === "notes") {
        const proposal = this.domainTools?.proposals.find(item => item.id === id)
        if (!proposal) throw new Error("Note proposal expired or unavailable")
        if (route === "/proposals/accept") {
          if (value.reviewed !== true || !this.preparationStore) throw new Error("Explicit note review is required")
          await this.serialPreparation(async () => {
            const preparation = await this.preparationStore!.save(proposal.content, proposal.expectedRevision)
            this.engine.updateSnapshot({ preparation, preparationError: null })
          })
        }
        this.domainTools!.removeProposal(id)
      } else if (value.kind === "guidance" && this.policyReview) {
        if (route === "/proposals/reject") this.policyReview.reject(id)
        else await this.policyReview.accept(id, value.reviewed === true, value.position as (AttachRequest & { attachmentId?: string; expectedAttachmentRevision?: string }) | undefined)
      } else throw new Error("Proposal review is unavailable")
      this.json(response, 200, { ok: true })
    } catch (error) { this.json(response, 400, { error: error instanceof Error ? error.message : "Review failed" }) }
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

  private async executeDomainTool(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 512 * 1024) { this.json(response, 413, { error: "request-too-large" }); return }
        chunks.push(buffer)
      }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid tool request")
      response.once("close", () => { if (!response.writableEnded && value.operation === "stage_exit" && typeof value.sessionId === "string") void this.domainTools?.cancelSession(value.sessionId) })
      const result = await this.domainTools!.execute(value.operation, value.input, value.sessionId, value.source as import("../copilot/TicketPermissions.mts").ToolSource | undefined)
      this.json(response, 200, result)
    } catch { this.json(response, 400, { error: "Cairo tool request was rejected. Read current context before continuing." }) }
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
