import path from "node:path"
import type { CopilotChat as ChatState, CopilotChatMessage } from "../shared/contracts.mts"
import type { CairoEngine } from "../engine/CairoEngine.mts"
import type { OpenCodeClient } from "./OpenCodeSidecar.mts"

export interface ChatOptions {
  engine: CairoEngine
  client(): OpenCodeClient | undefined
  workspace: string
  model: { providerID: string; id: string }
  fake: boolean
  configured(): boolean
}

export class CopilotChat {
  private state: ChatState
  private client: OpenCodeClient | undefined
  private streamAbort: AbortController | undefined
  private streamTask: Promise<void> | undefined
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private poll: ReturnType<typeof setInterval> | undefined
  private generation = 0
  private refreshTask: Promise<void> | undefined
  private operations: Promise<unknown> = Promise.resolve()
  private awaitingCommand: string | undefined
  private commands = new Map<string, string>()
  private streamedText = new Map<string, string>()
  private seenEvents = new Set<string>()
  private readonly options: ChatOptions
  constructor(options: ChatOptions) {
    this.options = options
    this.state = { sessionId: null, model: `${options.model.providerID}/${options.model.id}`, fake: options.fake, connected: false, busy: false, error: null, outcome: null, messages: [], truncated: false }
    this.publish()
  }
  get snapshot(): ChatState { return structuredClone(this.state) }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.catch(() => {}).then(operation)
    this.operations = result
    return result
  }
  connect(): Promise<void> { return this.serial(() => this.connectOwned()) }
  async stop(): Promise<void> {
    ++this.generation
    this.streamAbort?.abort()
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = undefined
    if (this.poll) clearInterval(this.poll)
    this.poll = undefined
    await this.streamTask
    await this.refreshTask?.catch(() => {})
    this.streamedText.clear()
    this.seenEvents.clear()
    this.client = undefined
    this.state.connected = false
    this.publish()
  }
  private async connectOwned(): Promise<void> {
    await this.stop()
    if (!this.options.configured()) { this.fail("Choose a model and set CAIRO_OPENAI_API_KEY, then restart Cairo."); return }
    const client = this.options.client()
    if (!client) { this.fail("AI runtime is unavailable. Restart AI, then reconnect chat."); return }
    this.client = client
    const generation = this.generation
    try {
      const request = { signal: AbortSignal.timeout(10_000) }
      if (this.state.sessionId) {
        const session = await client.session.get({ sessionID: this.state.sessionId }, request)
        if (!this.owned(session.location.directory)) throw new Error("Session scope changed")
      } else {
        const sessions = await client.session.list({ directory: this.options.workspace, limit: 50, order: "desc" }, request)
        const existing = sessions.data.find(session => this.owned(session.location.directory) && session.metadata?.cairoChat === true && session.model?.providerID === this.options.model.providerID && session.model?.id === this.options.model.id)
        const session = existing ?? await client.session.create({ title: "Cairo trading preparation", location: { directory: this.options.workspace }, model: this.options.model, metadata: { cairoChat: true } }, request)
        this.state.sessionId = session.id
      }
      if (generation !== this.generation) return
      this.state.connected = true
      this.state.error = null
      const abort = new AbortController()
      this.streamAbort = abort
      this.streamTask = this.consume(client, abort, generation)
      await this.refresh(generation)
      this.poll = setInterval(() => { if (this.state.busy && this.state.connected) this.scheduleRefresh(generation) }, 500)
      this.poll.unref()
      this.publish()
    } catch { if (generation === this.generation) this.fail("Chat could not reconnect. Retry without resending your last message.") }
  }
  send(text: unknown, commandId: unknown): Promise<void> {
    return this.serial(async () => {
      if (typeof text !== "string" || !text.trim() || text.length > 8000 || typeof commandId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(commandId)) throw new Error("Message must contain 1–8000 characters and a command ID")
      if (this.commands.has(commandId)) {
        if (this.commands.get(commandId) !== text) throw new Error("Message command ID was already used with another payload")
        return
      }
      if (!this.client || !this.state.connected || !this.state.sessionId || this.state.busy) throw new Error("Reconnect chat or wait for the current reply")
      this.commands.set(commandId, text)
      if (this.commands.size > 500) this.commands.delete(this.commands.keys().next().value!)
      this.awaitingCommand = commandId
      this.state.busy = true
      this.state.error = null
      this.state.outcome = null
      this.publish()
      const generation = this.generation
      try {
        await this.client.session.prompt({ sessionID: this.state.sessionId, text, metadata: { cairoCommand: commandId } }, { signal: AbortSignal.timeout(10_000) })
        await this.refresh(generation)
      } catch {
        if (generation === this.generation) this.fail("Message delivery is uncertain. Reconnect to inspect the session; Cairo will not resend it.")
        throw new Error("Message delivery is uncertain; reconnect before sending again")
      }
    })
  }
  cancel(): Promise<void> {
    return this.serial(async () => {
      if (!this.client || !this.state.sessionId || !this.state.connected) throw new Error("Reconnect before canceling")
      try {
        await this.client.session.interrupt({ sessionID: this.state.sessionId, resume: false }, { signal: AbortSignal.timeout(10_000) })
        this.awaitingCommand = undefined
        await this.refresh(this.generation)
      } catch { this.fail("Cancellation is unconfirmed. Reconnect to inspect the session."); throw new Error("Cancellation is unconfirmed") }
    })
  }
  private owned(directory: string): boolean { return path.resolve(directory).toLowerCase() === path.resolve(this.options.workspace).toLowerCase() }
  private async consume(client: OpenCodeClient, abort: AbortController, generation: number): Promise<void> {
    try {
      for await (const event of client.event.subscribe({ signal: abort.signal })) {
        if (generation !== this.generation) return
        const data = event.data as { sessionID?: string }
        if (data?.sessionID === this.state.sessionId) {
          if (event.type === "session.text.delta" && !this.seenEvents.has(event.id)) {
            this.seenEvents.add(event.id)
            if (this.seenEvents.size > 2000) this.seenEvents.delete(this.seenEvents.values().next().value!)
            const id = event.data.assistantMessageID
            const previous = this.streamedText.get(id) ?? this.state.messages.find(message => message.id === id)?.text ?? ""
            const text = (previous + event.data.delta).slice(0, 16_000)
            this.streamedText.set(id, text)
            const message = this.state.messages.find(message => message.id === id)
            if (message) message.text = text
            else this.state.messages = [...this.state.messages, { id, role: "assistant" as const, text, tools: [] }].slice(-40)
            this.publish()
          }
          this.scheduleRefresh(generation)
        }
      }
      if (!abort.signal.aborted && generation === this.generation) this.fail("Chat stream disconnected. Reconnect to recover current messages.")
    } catch { if (!abort.signal.aborted && generation === this.generation) this.fail("Chat stream disconnected. Reconnect to recover current messages.") }
  }
  private scheduleRefresh(generation: number): void {
    if (this.refreshTimer) return
    this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; void this.refresh(generation).catch(() => { if (generation === this.generation) this.fail("Chat refresh failed; reconnect to inspect current messages.") }) }, 40)
  }
  private refresh(generation: number): Promise<void> {
    if (this.refreshTask) return this.refreshTask
    const task = this.read(generation).finally(() => { if (this.refreshTask === task) this.refreshTask = undefined })
    this.refreshTask = task
    return task
  }
  private async read(generation: number): Promise<void> {
    const client = this.client
    const sessionID = this.state.sessionId
    if (!client || !sessionID) return
    const context = await client.session.context({ sessionID }, { signal: AbortSignal.timeout(5000) })
    if (generation !== this.generation || client !== this.client) return
    if (this.awaitingCommand && context.some(message => message.type === "user" && message.metadata?.cairoCommand === this.awaitingCommand)) this.awaitingCommand = undefined
    const last = context.at(-1)
    this.state.busy = Boolean(this.awaitingCommand) || (context.length > 0 && last?.type !== "idle")
    this.state.outcome = last?.type === "idle" ? last.outcome : null
    if (this.state.outcome === "failed") this.state.error = "Model request failed. Check provider/model settings; no action was submitted."
    const messages: CopilotChatMessage[] = []
    for (const message of context) {
      if (message.type === "user") messages.push({ id: message.id, role: "user", text: message.text.slice(0, 8000), tools: [] })
      if (message.type === "assistant") messages.push({ id: message.id, role: "assistant", text: message.content.filter(part => part.type === "text").map(part => part.text).join("").slice(0, 16_000), tools: message.content.filter(part => part.type === "tool").map(part => ({ name: part.name, state: part.state.status })).slice(0, 20) })
    }
    for (const message of messages) {
      const streamed = this.streamedText.get(message.id)
      if (streamed && streamed.length > message.text.length) message.text = streamed
    }
    this.state.messages = messages.slice(-40)
    if (!this.state.busy) this.streamedText.clear()
    this.state.truncated = messages.length > 40 || context.some(message => message.type === "assistant" && message.content.filter(part => part.type === "text").map(part => part.text).join("").length > 16_000)
    this.publish()
  }
  private fail(error: string): void { this.streamAbort?.abort(); this.state.connected = false; this.state.error = error; this.publish() }
  private publish(): void { this.options.engine.updateSnapshot({ copilotChat: this.snapshot }) }
}
