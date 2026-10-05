import type { ChartBar, ChartSnapshot, HttpPort } from "../shared/contracts.mts"

export type MassiveRefreshResult =
  | { ok: true; snapshot: ChartSnapshot }
  | { ok: false; snapshot: ChartSnapshot | null; error: string }

export class MassiveRestReader {
  private readonly http: HttpPort
  private readonly apiKey: () => string | null
  private readonly baseUrl: URL
  private cache = new Map<string, ChartSnapshot>()

  constructor(http: HttpPort, apiKey: () => string | null, baseUrl = "https://api.massive.com") {
    this.http = http
    this.apiKey = apiKey
    this.baseUrl = new URL(baseUrl)
    if (this.baseUrl.protocol !== "https:") throw new Error("Massive API must use HTTPS")
  }

  getSnapshot(symbol: string, date: string): ChartSnapshot | null {
    const snapshot = this.cache.get(cacheKey(symbol, date))
    return snapshot ? structuredClone(snapshot) : null
  }

  async refresh(symbol: string, date: string, fetchedAt = new Date().toISOString()): Promise<MassiveRefreshResult> {
    const canonical = validateSymbolDate(symbol, date)
    const key = cacheKey(canonical, date)
    const old = this.cache.get(key) ?? null
    const secret = this.apiKey()
    if (!secret) return { ok: false, snapshot: old ? structuredClone(old) : null, error: "Massive API key is not configured" }
    try {
      const bars = await this.fetchBars(canonical, date, secret)
      const byMinute = new Map<number, ChartBar>()
      for (const bar of old?.bars ?? []) byMinute.set(bar.time, bar)
      for (const bar of bars) byMinute.set(bar.time, bar)
      // An explicit empty day is meaningful and replaces a formerly populated cache.
      const merged = bars.length === 0 ? [] : [...byMinute.values()].sort((a, b) => a.time - b.time)
      const snapshot: ChartSnapshot = {
        symbol: canonical,
        interval: "1m",
        fetchedAt: validIso(fetchedAt),
        latestBarAt: merged.length ? new Date(merged[merged.length - 1].time).toISOString() : null,
        bars: merged,
        source: { source: "chart", state: "connected", updatedAt: fetchedAt, detail: "Massive REST snapshot · no live updates" },
      }
      this.cache.set(key, snapshot)
      return { ok: true, snapshot: structuredClone(snapshot) }
    } catch (error) {
      return { ok: false, snapshot: old ? structuredClone(old) : null, error: safeError(error) }
    }
  }

  private async fetchBars(symbol: string, date: string, apiKey: string): Promise<ChartBar[]> {
    let next: string | null = new URL(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/minute/${date}/${date}?adjusted=true&sort=asc&limit=50000`, this.baseUrl).toString()
    const visited = new Set<string>()
    const bars = new Map<number, ChartBar>()
    while (next) {
      const url = new URL(next)
      if (url.origin !== this.baseUrl.origin || url.protocol !== "https:") throw new Error("Massive pagination left the configured HTTPS host")
      const canonicalUrl = url.toString()
      if (visited.has(canonicalUrl)) throw new Error("Massive pagination repeated a cursor")
      visited.add(canonicalUrl)
      const response = await this.http.request(canonicalUrl, { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } })
      if (response.status !== 200) throw new Error(`Massive REST returned HTTP ${response.status}`)
      const payload = parsePayload(response.body)
      if (payload.status === "ERROR" || payload.status === "NOT_AUTHORIZED") throw new Error("Massive REST rejected the aggregate request")
      if (payload.results !== undefined && !Array.isArray(payload.results)) throw new Error("Massive REST returned invalid aggregate results")
      for (const item of payload.results ?? []) {
        const bar = mapAggregate(item)
        bars.set(bar.time, bar)
      }
      next = typeof payload.next_url === "string" && payload.next_url ? payload.next_url : null
    }
    return [...bars.values()].sort((a, b) => a.time - b.time)
  }
}

function mapAggregate(input: unknown): ChartBar {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Massive aggregate is invalid")
  const value = input as Record<string, unknown>
  const time = finite(value.t, "timestamp")
  if (!Number.isSafeInteger(time) || time < 0 || time % 60_000 !== 0) throw new Error("Massive aggregate timestamp is not a one-minute boundary")
  const open = positive(value.o, "open"), high = positive(value.h, "high"), low = positive(value.l, "low"), close = positive(value.c, "close"), volume = finite(value.v, "volume")
  if (volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) throw new Error("Massive aggregate OHLCV is inconsistent")
  return { time, open, high, low, close, volume }
}

function parsePayload(body: unknown): Record<string, unknown> {
  let value = body
  if (typeof body === "string") {
    try { value = JSON.parse(body) } catch { throw new Error("Massive REST returned invalid JSON") }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Massive REST returned invalid JSON object")
  return value as Record<string, unknown>
}
function finite(value: unknown, name: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Massive aggregate ${name} is invalid`); return value }
function positive(value: unknown, name: string): number { const result = finite(value, name); if (result <= 0) throw new Error(`Massive aggregate ${name} must be positive`); return result }
function validIso(value: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("fetchedAt must be an ISO timestamp"); return new Date(value).toISOString() }
function validateSymbolDate(symbol: string, date: string): string {
  const canonical = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9.\-]{1,16}$/.test(canonical)) throw new Error("Chart symbol is invalid")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) throw new Error("Chart date must use YYYY-MM-DD")
  return canonical
}
function cacheKey(symbol: string, date: string): string { return `${symbol.trim().toUpperCase()}|${date}` }
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Massive REST refresh failed"
  // Provider error bodies can echo request credentials; never surface credential-shaped strings.
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240)
}
