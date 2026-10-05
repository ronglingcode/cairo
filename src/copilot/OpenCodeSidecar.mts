import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { OpenCode } from "@opencode/client"
import type { SourceStatus } from "../shared/contracts.mts"

export type OpenCodeClient = ReturnType<typeof OpenCode.make>

export interface SidecarOptions {
  binary: string
  userDataPath: string
  onStatus(status: SourceStatus): void
  config?: Record<string, unknown>
  environment?: Record<string, string>
  spawnProcess?: typeof spawn
  makeClient?: (url: string, password: string) => OpenCodeClient
  startupTimeoutMs?: number
  healthIntervalMs?: number
}

export class OpenCodeSidecar {
  readonly workspace: string
  readonly root: string
  private child: ChildProcess | undefined
  private currentClient: OpenCodeClient | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private healthTimer: ReturnType<typeof setInterval> | undefined
  private generation = 0
  private readonly options: SidecarOptions
  private statusValue: SourceStatus = { source: "copilot", state: "waiting", updatedAt: null, detail: "Copilot has not started" }

  constructor(options: SidecarOptions) {
    this.options = options
    this.root = path.join(options.userDataPath, "copilot")
    this.workspace = path.join(this.root, "workspace")
  }

  get client(): OpenCodeClient | undefined { return this.currentClient }
  get status(): SourceStatus { return { ...this.statusValue } }
  get processId(): number | undefined { return this.child?.pid }

  start(): Promise<boolean> { return this.serial(() => this.startOwned()) }
  stop(): Promise<void> { return this.serial(() => this.stopOwned()) }
  restart(): Promise<boolean> { return this.serial(async () => { await this.stopOwned(); return this.startOwned() }) }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(operation)
    this.queue = next
    return next
  }

  private async startOwned(): Promise<boolean> {
    if (this.child) return this.currentClient !== undefined
    const generation = ++this.generation
    this.publish("waiting", "Starting Cairo's OpenCode runtime")
    try {
      await mkdir(this.workspace, { recursive: true })
      const config = this.options.config ?? { snapshots: false, permissions: [{ action: "*", resource: "*", effect: "deny" }] }
      await writeFile(path.join(this.workspace, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8")
      const environment: NodeJS.ProcessEnv = {}
      for (const [key, value] of Object.entries(process.env)) {
        if (/^(SystemRoot|windir|PATHEXT|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)) environment[key] = value
      }
      const windowsDirectory = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows"
      environment.PATH = `${windowsDirectory}\\System32;${windowsDirectory}`
      for (const [key, subdirectory] of Object.entries({ XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data", XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state" })) {
        environment[key] = path.join(this.root, subdirectory)
        await mkdir(environment[key]!, { recursive: true })
      }
      environment.OPENCODE_CONFIG_DIR = path.join(this.root, "config", "opencode")
      await mkdir(environment.OPENCODE_CONFIG_DIR, { recursive: true })
      Object.assign(environment, this.options.environment)
      const password = randomBytes(32).toString("hex")
      environment.OPENCODE_SERVER_PASSWORD = password
      const child = (this.options.spawnProcess ?? spawn)(this.options.binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
        cwd: this.workspace, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      })
      this.child = child
      child.once("exit", () => {
        if (this.child !== child) return
        this.child = undefined
        this.currentClient = undefined
        this.clearHealth()
        this.publish("disconnected", "Cairo's OpenCode runtime stopped; restart to reconnect")
      })
      const url = await this.startupUrl(child)
      const client = this.options.makeClient?.(url, password) ?? OpenCode.make({
        baseUrl: url,
        headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
      })
      const info = await client.server.info({ signal: AbortSignal.timeout(this.options.startupTimeoutMs ?? 20_000) })
      if (info.version !== "2.0.22" || info.pid !== child.pid || this.child !== child || generation !== this.generation) {
        throw new Error("Unexpected runtime identity")
      }
      this.currentClient = client
      this.publish("connected", "Cairo OpenCode 2.0.22 is ready")
      const interval = this.options.healthIntervalMs ?? 15_000
      this.healthTimer = setInterval(() => { void this.checkHealth(child, client, generation) }, interval)
      this.healthTimer.unref()
      return true
    } catch {
      await this.stopOwned()
      this.publish("disconnected", "Copilot could not start. Check the pinned runtime resources, then restart.")
      return false
    }
  }

  private startupUrl(child: ChildProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = ""
      const timer = setTimeout(() => finish(new Error("Runtime startup timed out")), this.options.startupTimeoutMs ?? 20_000)
      const finish = (error?: Error, url?: string) => {
        clearTimeout(timer)
        child.stdout?.off("data", onData)
        child.stderr?.off("data", onData)
        child.off("error", onError)
        child.off("exit", onExit)
        if (error) reject(error)
        else resolve(url!)
      }
      const onData = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-65_536)
        const url = output.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
        if (url) finish(undefined, url)
      }
      const onError = () => finish(new Error("Runtime launch failed"))
      const onExit = () => finish(new Error("Runtime exited during startup"))
      child.stdout?.on("data", onData)
      child.stderr?.on("data", onData)
      child.once("error", onError)
      child.once("exit", onExit)
    })
  }

  private async checkHealth(child: ChildProcess, client: OpenCodeClient, generation: number): Promise<void> {
    try {
      const info = await client.server.info({ signal: AbortSignal.timeout(5_000) })
      if (this.child === child && generation === this.generation) {
        this.publish(info.version === "2.0.22" && info.pid === child.pid ? "connected" : "stale", "Checking Cairo OpenCode runtime")
      }
    } catch {
      if (this.child === child && generation === this.generation) this.publish("stale", "Copilot health check failed; notes and chart remain available")
    }
  }

  private async stopOwned(): Promise<void> {
    ++this.generation
    this.currentClient = undefined
    this.clearHealth()
    const child = this.child
    if (child) {
      if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
        await new Promise<void>((resolve, reject) => {
          const onExit = () => { clearTimeout(timer); resolve() }
          const timer = setTimeout(() => { child.off("exit", onExit); reject(new Error("Owned copilot process did not stop")) }, 5_000)
          child.once("exit", onExit)
          child.kill()
        })
      }
      if (this.child === child) this.child = undefined
    }
    this.publish("disconnected", "Cairo's OpenCode runtime stopped")
  }

  private clearHealth(): void { if (this.healthTimer) clearInterval(this.healthTimer); this.healthTimer = undefined }
  private publish(state: SourceStatus["state"], detail: string): void {
    this.statusValue = { source: "copilot", state, detail, updatedAt: new Date().toISOString() }
    this.options.onStatus({ ...this.statusValue })
  }
}
