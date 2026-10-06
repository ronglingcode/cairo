import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { readReferencedSecrets, type ReferencedSecrets } from "./ReferencedSecrets.mts"

export type ProviderSelection = "openai" | "fake"

export interface CairoConfig {
  workspace_root_path: string
  tradebooks_root_path: string
  selectedAccountId: string
  bookmapEndpoint: string
  schwabTokenFile: string
  secretsFile: string
  chartSymbol: string
  chartDate: string
  provider: ProviderSelection
  model: string
}

export interface PublicConfiguration {
  workspace_root_path: string
  tradebooks_root_path: string
  configPath: string
  selectedAccountId: string | null
  bookmapEndpoint: string
  schwabTokenFile: string
  secretsFile: string
  secretsError: string | null
  chartSymbol: string
  chartDate: string
  provider: ProviderSelection
  model: string
  setupRequired: boolean
}

const DEFAULTS: CairoConfig = {
  workspace_root_path: "",
  tradebooks_root_path: "",
  selectedAccountId: "",
  bookmapEndpoint: "ws://127.0.0.1:8765",
  schwabTokenFile: path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "bmtrader", "secrets.json"),
  secretsFile: "",
  chartSymbol: "SPY",
  chartDate: new Date().toISOString().slice(0, 10),
  provider: "fake",
  model: "",
}

export class LocalConfiguration {
  readonly configPath: string
  private current: CairoConfig = { ...DEFAULTS }
  private secrets: ReferencedSecrets = {}
  private secretsError: string | null = null

  constructor(userDataPath: string) {
    this.configPath = path.join(userDataPath, "config.json")
    this.current.tradebooks_root_path = defaultTradebooksRoot()
    this.current.workspace_root_path = path.join(homedir(), "trading")
  }

  async load(): Promise<PublicConfiguration> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.configPath, "utf8"))
      this.current = validateConfig(raw)
    } catch (error) {
      if (!isMissingFile(error)) throw error
      await this.save(this.current)
    }
    await this.loadReferencedSecrets()
    return this.publicView()
  }

  get values(): Readonly<CairoConfig> { return { ...this.current, selectedAccountId: this.current.selectedAccountId || this.secrets.schwab?.accountId || "" } }

  get massiveApiKey(): string | null { return process.env.CAIRO_MASSIVE_API_KEY?.trim() || this.secrets.massive?.apiKey || null }
  get openAiApiKey(): string | null { return this.current.secretsFile ? this.secrets.openai?.apiKey || null : process.env.CAIRO_OPENAI_API_KEY?.trim() || null }

  async save(next: CairoConfig): Promise<PublicConfiguration> {
    const valid = validateConfig(next)
    await mkdir(path.dirname(this.configPath), { recursive: true })
    await writeFile(this.configPath, `${JSON.stringify(valid, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    this.current = valid
    await this.loadReferencedSecrets()
    return this.publicView()
  }

  private publicView(): PublicConfiguration {
    return {
      workspace_root_path: this.current.workspace_root_path,
      tradebooks_root_path: this.current.tradebooks_root_path,
      configPath: this.configPath,
      selectedAccountId: this.values.selectedAccountId || null,
      bookmapEndpoint: this.current.bookmapEndpoint,
      schwabTokenFile: this.current.schwabTokenFile,
      secretsFile: this.current.secretsFile,
      secretsError: this.secretsError,
      chartSymbol: this.current.chartSymbol,
      chartDate: this.current.chartDate,
      provider: this.current.provider,
      model: this.current.model,
      setupRequired: !this.values.selectedAccountId || (this.current.provider === "openai" && !this.current.model) || Boolean(this.secretsError),
    }
  }

  private async loadReferencedSecrets(): Promise<void> {
    this.secrets = {}
    this.secretsError = null
    if (!this.current.secretsFile) return
    try { this.secrets = await readReferencedSecrets(this.current.secretsFile) }
    catch { this.secretsError = "Cannot read secretsFile; check its path and provisioning format, then restart Cairo." }
  }
}

function validateConfig(input: unknown): CairoConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Cairo config must be an object")
  const value = input as Record<string, unknown>
  const result: CairoConfig = {
    workspace_root_path: optionalString(value.workspace_root_path, path.join(homedir(), "trading")),
    tradebooks_root_path: optionalString(value.tradebooks_root_path, defaultTradebooksRoot()),
    selectedAccountId: optionalString(value.selectedAccountId, DEFAULTS.selectedAccountId),
    bookmapEndpoint: optionalString(value.bookmapEndpoint, DEFAULTS.bookmapEndpoint),
    schwabTokenFile: optionalString(value.schwabTokenFile, DEFAULTS.schwabTokenFile),
    secretsFile: optionalString(value.secretsFile, DEFAULTS.secretsFile),
    chartSymbol: optionalString(value.chartSymbol, DEFAULTS.chartSymbol).toUpperCase(),
    chartDate: optionalString(value.chartDate, DEFAULTS.chartDate),
    provider: value.provider === undefined ? DEFAULTS.provider : value.provider as ProviderSelection,
    model: optionalString(value.model, DEFAULTS.model),
  }
  if (!result.bookmapEndpoint.startsWith("ws://127.0.0.1:") && !result.bookmapEndpoint.startsWith("wss://127.0.0.1:")) throw new Error("Bookmap endpoint must use loopback")
  if (!result.chartSymbol || !/^[A-Z0-9.\-]{1,16}$/.test(result.chartSymbol)) throw new Error("chartSymbol is invalid")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.chartDate) || !Number.isFinite(Date.parse(`${result.chartDate}T00:00:00Z`))) throw new Error("chartDate must use YYYY-MM-DD")
  if (result.provider !== "openai" && result.provider !== "fake") throw new Error("provider must be openai or fake")
  if (result.secretsFile && !path.isAbsolute(result.secretsFile)) throw new Error("secretsFile must be an absolute path")
  if (!result.tradebooks_root_path || !path.isAbsolute(result.tradebooks_root_path)) throw new Error("Tradebooks root path must be an absolute path")
  if (!result.workspace_root_path || !path.isAbsolute(result.workspace_root_path)) throw new Error("Workspace root path must be an absolute path")
  result.workspace_root_path = path.resolve(result.workspace_root_path)
  result.tradebooks_root_path = path.resolve(result.tradebooks_root_path)
  return result
}

function defaultTradebooksRoot(): string {
  if (process.env.CAIRO_TRADEBOOK_PATH?.trim()) return path.resolve(process.env.CAIRO_TRADEBOOK_PATH.trim())
  const workspaceRoot = path.join(homedir(), "trading", "Backtest", "tradebooks")
  return existsSync(workspaceRoot) ? workspaceRoot : path.join(homedir(), "code", "Backtest", "tradebooks")
}

function optionalString(value: unknown, fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== "string") throw new Error("configuration string field is invalid")
  return value.trim()
}

function isMissingFile(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT" }
