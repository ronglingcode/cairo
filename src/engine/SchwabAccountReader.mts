import { parseBrokerFacts, type BrokerFacts, type BrokerPosition, type HttpPort, type SourceStatus } from "../shared/contracts.mts"
import { BookmapTokenProvider } from "./BookmapTokenProvider.mts"

export interface SchwabReadResult { facts: BrokerFacts | null; status: SourceStatus; error: string | null }

export class SchwabAccountReader {
  private readonly http: HttpPort
  private readonly tokens: BookmapTokenProvider
  private readonly baseUrl: string
  private readonly now: () => number

  constructor(http: HttpPort, tokens: BookmapTokenProvider, options: { baseUrl?: string; now?: () => number } = {}) {
    this.http = http
    this.tokens = tokens
    this.baseUrl = (options.baseUrl ?? "https://api.schwabapi.com/trader/v1").replace(/\/$/, "")
    this.now = options.now ?? Date.now
    if (!this.baseUrl.startsWith("https://")) throw new Error("Schwab API must use HTTPS")
  }

  async readSelectedAccount(): Promise<SchwabReadResult> {
    const authorization = await this.tokens.readForSelectedAccount()
    if (!authorization) return this.failure(this.tokens.status.state === "waiting" ? "waiting" : "stale", this.tokens.status.detail)
    try {
      const map = await this.readJson("/accounts/accountNumbers", authorization.accessToken)
      if (!Array.isArray(map)) throw new Error("Schwab account-number response is invalid")
      const matches = map.filter((entry) => entry && typeof entry === "object" && (
        String((entry as Record<string, unknown>).accountNumber ?? "") === authorization.accountId ||
        String((entry as Record<string, unknown>).hashValue ?? "") === authorization.accountId
      )) as Array<Record<string, unknown>>
      if (matches.length !== 1) throw new Error(matches.length ? "Selected Schwab account mapping is ambiguous" : "Selected Schwab account is not available to this authorization")
      const hashValue = matches[0].hashValue
      if (typeof hashValue !== "string" || !hashValue.trim()) throw new Error("Schwab account mapping has no account hash")
      const accountResponse = await this.readJson(`/accounts/${encodeURIComponent(hashValue)}?fields=positions`, authorization.accessToken)
      const account = accountResponse && typeof accountResponse === "object" && !Array.isArray(accountResponse)
        ? ((accountResponse as Record<string, unknown>).securitiesAccount ?? accountResponse) as Record<string, unknown>
        : null
      if (!account || typeof account !== "object") throw new Error("Schwab account response has no securitiesAccount")
      const positions = normalizePositions(account.positions, hashValue)
      const updatedAt = new Date(this.now()).toISOString()
      const source: SourceStatus = { source: "broker", state: "connected", updatedAt, detail: "Selected Schwab account read; order coverage pending" }
      const facts = parseBrokerFacts({
          accountId: authorization.accountId,
          asOf: updatedAt,
          positions,
          workingOrders: [],
          recentFills: [],
          ordersComplete: false,
          source,
        })
      return {
        facts,
        status: source,
        error: null,
      }
    } catch (error) {
      const status = error instanceof SchwabUnauthorizedError ? "stale" : "stale"
      if (error instanceof SchwabUnauthorizedError) this.tokens.invalidate()
      return this.failure(status, safeMessage(error))
    }
  }

  private async readJson(path: string, token: string): Promise<unknown> {
    const response = await this.http.request(`${this.baseUrl}${path}`, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
    if (response.status === 401 || response.status === 403) throw new SchwabUnauthorizedError()
    if (response.status !== 200) throw new Error(`Schwab account read returned HTTP ${response.status}`)
    if (typeof response.body === "string") {
      try { return JSON.parse(response.body) } catch { throw new Error("Schwab account response is invalid JSON") }
    }
    return response.body
  }

  private failure(state: "waiting" | "stale" | "disconnected", detail: string): SchwabReadResult {
    const status: SourceStatus = { source: "broker", state, updatedAt: new Date(this.now()).toISOString(), detail }
    return { facts: null, status, error: detail }
  }
}

class SchwabUnauthorizedError extends Error { constructor() { super("Schwab rejected the Bookmap token") } }

function normalizePositions(input: unknown, accountHash: string): BrokerPosition[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new Error("Schwab account positions are invalid")
  const result: BrokerPosition[] = []
  for (const value of input) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Schwab position is invalid")
    const position = value as Record<string, unknown>
    const instrument = position.instrument
    if (!instrument || typeof instrument !== "object" || Array.isArray(instrument)) throw new Error("Schwab position instrument is invalid")
    const item = instrument as Record<string, unknown>
    if (item.assetType !== undefined && item.assetType !== "EQUITY") continue
    const symbol = item.symbol
    if (typeof symbol !== "string" || !symbol.trim()) throw new Error("Schwab equity position has no symbol")
    const long = nonnegative(position.longQuantity ?? 0, "long quantity")
    const short = nonnegative(position.shortQuantity ?? 0, "short quantity")
    const signed = long - short
    if (signed === 0) continue
    const quantity = Math.abs(signed)
    const averagePrice = positive(position.averagePrice, "average price")
    const marketValue = typeof position.marketValue === "number" && Number.isFinite(position.marketValue) ? Math.abs(position.marketValue) : NaN
    const markPrice = Number.isFinite(marketValue) && marketValue > 0 ? marketValue / quantity : null
    const instrumentId = typeof item.cusip === "string" && item.cusip ? item.cusip : symbol
    result.push({
      positionId: `${accountHash}:${instrumentId}:${signed > 0 ? "long" : "short"}`,
      symbol: symbol.trim().toUpperCase(),
      side: signed > 0 ? "long" : "short",
      quantity,
      averagePrice,
      markPrice,
    })
  }
  return result
}

function nonnegative(value: unknown, name: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Schwab ${name} is invalid`); return value }
function positive(value: unknown, name: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`Schwab ${name} is invalid`); return value }
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Schwab account read failed").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240)
}
