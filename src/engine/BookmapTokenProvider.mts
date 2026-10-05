import { readFile } from "node:fs/promises"

export type TokenState = "connected" | "waiting" | "stale"
export interface SchwabAuthorization {
  accessToken: string
  accountId: string
  expiresAt: number
}
export interface TokenStatus { state: TokenState; detail: string; updatedAt: string }

export class BookmapTokenProvider {
  private readonly config: () => { selectedAccountId: string; schwabTokenFile: string }
  private readonly now: () => number
  private readonly expiryLeadMs: number
  private statusValue: TokenStatus = { state: "waiting", detail: "Waiting for Bookmap token file", updatedAt: new Date(0).toISOString() }

  constructor(
    config: () => { selectedAccountId: string; schwabTokenFile: string },
    options: { now?: () => number; expiryLeadMs?: number } = {},
  ) {
    this.config = config
    this.now = options.now ?? Date.now
    this.expiryLeadMs = options.expiryLeadMs ?? 60_000
    if (!Number.isFinite(this.expiryLeadMs) || this.expiryLeadMs < 0) throw new RangeError("expiryLeadMs must be finite and nonnegative")
  }

  get status(): TokenStatus { return { ...this.statusValue } }

  async readForSelectedAccount(): Promise<SchwabAuthorization | null> {
    const config = this.config()
    if (!config.selectedAccountId.trim()) return this.setStatus("waiting", "Select a Schwab account")
    if (!config.schwabTokenFile.trim()) return this.setStatus("waiting", "Configure the Bookmap token file path")
    let raw: string
    try { raw = await readFile(config.schwabTokenFile, "utf8") }
    catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      return this.setStatus(code === "ENOENT" ? "waiting" : "stale", code === "ENOENT" ? "Bookmap token file is missing" : "Bookmap token file cannot be read")
    }
    try {
      const value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""))
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid")
      const schwab = (value as Record<string, unknown>).schwab
      if (!schwab || typeof schwab !== "object" || Array.isArray(schwab)) throw new Error("missing schwab section")
      const section = schwab as Record<string, unknown>
      const accessToken = section.access_token
      const expiresAt = section.expires_at
      if (typeof accessToken !== "string" || !accessToken.trim() || typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= 0) throw new Error("invalid token")
      if (expiresAt <= this.now() + this.expiryLeadMs) return this.setStatus("stale", "Bookmap token expires within 60 seconds or is expired")
      const authorization = { accessToken, accountId: config.selectedAccountId, expiresAt }
      this.statusValue = { state: "connected", detail: "Using Bookmap-maintained Schwab token", updatedAt: new Date(this.now()).toISOString() }
      return authorization
    } catch {
      return this.setStatus("stale", "Bookmap token file is malformed or missing valid Schwab authorization")
    }
  }

  invalidate(): void { this.statusValue = { state: "stale", detail: "Schwab rejected the Bookmap token; waiting for file rotation", updatedAt: new Date(this.now()).toISOString() } }

  private setStatus(state: TokenState, detail: string): null {
    this.statusValue = { state, detail, updatedAt: new Date(this.now()).toISOString() }
    return null
  }
}
