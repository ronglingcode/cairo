import { createHash } from "node:crypto"
import type { BrokerFill, BrokerWorkingOrder, HttpPort } from "../shared/contracts.mts"
import { BookmapTokenProvider } from "./BookmapTokenProvider.mts"

export interface SchwabOrdersResult {
  accountId: string
  workingOrders: BrokerWorkingOrder[]
  recentFills: BrokerFill[]
  ordersComplete: boolean
  asOf: string
  error: string | null
}

const DAY_MS = 86_400_000
const DEFAULT_LOOKBACK_DAYS = 60
const RECENT_FILL_DAYS = 7
const MAX_RESULTS = 500
const MIN_WINDOW_MS = 60_000

export class SchwabOrderReader {
  private readonly http: HttpPort
  private readonly tokens: BookmapTokenProvider
  private readonly baseUrl: string
  private readonly now: () => number
  private readonly lookbackDays: number
  private readonly maxResults: number
  private readonly minWindowMs: number

  constructor(http: HttpPort, tokens: BookmapTokenProvider, options: { baseUrl?: string; now?: () => number; lookbackDays?: number; maxResults?: number; minWindowMs?: number } = {}) {
    this.http = http
    this.tokens = tokens
    this.baseUrl = (options.baseUrl ?? "https://api.schwabapi.com/trader/v1").replace(/\/$/, "")
    this.now = options.now ?? Date.now
    this.lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
    this.maxResults = options.maxResults ?? MAX_RESULTS
    this.minWindowMs = options.minWindowMs ?? MIN_WINDOW_MS
    if (!this.baseUrl.startsWith("https://")) throw new Error("Schwab API must use HTTPS")
    if (!Number.isInteger(this.lookbackDays) || this.lookbackDays < 1 || this.lookbackDays > 60) throw new RangeError("Schwab lookback must be from 1 to 60 days")
    if (!Number.isInteger(this.maxResults) || this.maxResults < 1 || !Number.isFinite(this.minWindowMs) || this.minWindowMs < 1000) throw new RangeError("Schwab order paging limits are invalid")
  }

  async readSelectedAccountOrders(): Promise<SchwabOrdersResult> {
    const selected = this.tokens.status
    const authorization = await this.tokens.readForSelectedAccount()
    const asOf = new Date(this.now()).toISOString()
    if (!authorization) return this.failed("", asOf, this.tokens.status.detail)
    try {
      const mappings = await this.getJson("/accounts/accountNumbers", authorization.accessToken)
      if (!Array.isArray(mappings)) throw new Error("Schwab account-number response is invalid")
      const matches = mappings.filter((item) => item && typeof item === "object" && (
        String((item as Record<string, unknown>).accountNumber ?? "") === authorization.accountId ||
        String((item as Record<string, unknown>).hashValue ?? "") === authorization.accountId
      )) as Array<Record<string, unknown>>
      if (matches.length !== 1 || typeof matches[0]?.hashValue !== "string" || !matches[0].hashValue) throw new Error("Selected Schwab account mapping is missing or ambiguous")
      const hashValue = matches[0].hashValue
      const from = this.now() - this.lookbackDays * DAY_MS
      let complete = true
      const rawOrders = new Map<string, Record<string, unknown>>()
      const readWindow = async (start: number, end: number): Promise<void> => {
        const query = new URLSearchParams({
          fromEnteredTime: new Date(start).toISOString(),
          toEnteredTime: new Date(end).toISOString(),
          maxResults: String(this.maxResults),
        })
        const response = await this.getJson(`/accounts/${encodeURIComponent(hashValue)}/orders?${query}`, authorization.accessToken)
        const orders = Array.isArray(response) ? response : response && typeof response === "object" && Array.isArray((response as Record<string, unknown>).orders) ? (response as Record<string, unknown>).orders as unknown[] : null
        if (!orders) throw new Error("Schwab orders response is not an array")
        if (orders.length >= this.maxResults) {
          if (end - start <= this.minWindowMs) { complete = false; for (const order of orders) recordOrder(order, rawOrders); return }
          const midpoint = Math.floor((start + end) / 2)
          await readWindow(start, midpoint)
          await readWindow(midpoint, end)
          return
        }
        for (const order of orders) recordOrder(order, rawOrders)
      }
      await readWindow(from, this.now())
      const fills = new Map<string, BrokerFill>()
      const orders = new Map<string, BrokerWorkingOrder>()
      const fillCutoff = this.now() - RECENT_FILL_DAYS * DAY_MS
      for (const raw of rawOrders.values()) visitOrder(raw, null, null, orders, fills, fillCutoff, () => { complete = false })
      return { accountId: authorization.accountId, workingOrders: [...orders.values()], recentFills: [...fills.values()].sort((a, b) => a.filledAt.localeCompare(b.filledAt)), ordersComplete: complete, asOf, error: complete ? null : "Schwab order response hit a broker result cap; coverage may be incomplete" }
    } catch (error) {
      const detail = safeMessage(error)
      if (/rejected the Bookmap token/i.test(detail)) this.tokens.invalidate()
      return this.failed(authorization.accountId, asOf, detail)
    }
  }

  private async getJson(path: string, token: string): Promise<unknown> {
    const response = await this.http.request(`${this.baseUrl}${path}`, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
    if (response.status === 401 || response.status === 403) throw new Error("Schwab rejected the Bookmap token")
    if (response.status !== 200) throw new Error(`Schwab orders read returned HTTP ${response.status}`)
    if (typeof response.body === "string") {
      try { return JSON.parse(response.body) } catch { throw new Error("Schwab orders response is invalid JSON") }
    }
    return response.body
  }

  private failed(accountId: string, asOf: string, error: string): SchwabOrdersResult {
    return { accountId, workingOrders: [], recentFills: [], ordersComplete: false, asOf, error }
  }
}

function recordOrder(raw: unknown, output: Map<string, Record<string, unknown>>): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Schwab order record is invalid")
  const order = raw as Record<string, unknown>
  const id = order.orderId ?? order.orderID
  if (id === undefined || id === null || String(id).length === 0) throw new Error("Schwab order is missing its identity")
  output.set(String(id), order)
}

function visitOrder(
  raw: Record<string, unknown>, parentId: string | null, ocoGroupId: string | null,
  orders: Map<string, BrokerWorkingOrder>, fills: Map<string, BrokerFill>, fillCutoff: number, incomplete: () => void,
): void {
  const id = String(raw.orderId ?? raw.orderID ?? "")
  const ownStrategy = typeof raw.orderStrategyType === "string" ? raw.orderStrategyType : "SINGLE"
  const groupId = ownStrategy === "OCO" ? id || ocoGroupId : ocoGroupId
  const legs = Array.isArray(raw.orderLegCollection) ? raw.orderLegCollection : []
  for (const legValue of legs) {
    if (!legValue || typeof legValue !== "object") { incomplete(); continue }
    const leg = legValue as Record<string, unknown>
    const instrument = leg.instrument
    if (!instrument || typeof instrument !== "object") { incomplete(); continue }
    const item = instrument as Record<string, unknown>
    if (item.assetType !== undefined && item.assetType !== "EQUITY") continue
    if (typeof item.symbol !== "string" || !item.symbol.trim()) { incomplete(); continue }
    const instruction = String(leg.instruction ?? "").toUpperCase()
    const side = instruction === "BUY" || instruction === "BUY_TO_COVER" ? "buy" : instruction === "SELL" || instruction === "SELL_SHORT" ? "sell" : null
    if (!side) { incomplete(); continue }
    const filledQuantity = optionalNonnegative(raw.filledQuantity) ?? 0
    const quantity = optionalPositive(raw.quantity) ?? optionalPositive(leg.quantity) ?? filledQuantity
    if (quantity <= 0) { incomplete(); continue }
    const brokerStatus = typeof raw.status === "string" ? raw.status : "UNKNOWN"
    const status = normalizeStatus(brokerStatus)
    const fillCountBefore = fills.size
    collectFills(raw, leg, id, item.symbol, side, fills, fillCutoff)
    const hasRecentFills = fills.size > fillCountBefore
    const enteredAt = typeof raw.enteredTime === "string" ? Date.parse(raw.enteredTime) : NaN
    const recentlyEntered = Number.isFinite(enteredAt) && enteredAt >= fillCutoff
    if (isWorking(status) || hasRecentFills || recentlyEntered) {
      const order: BrokerWorkingOrder = {
        orderId: id,
        symbol: item.symbol.toUpperCase(),
        side,
        quantity,
        filledQuantity,
        status,
        brokerStatus, instruction, session: typeof raw.session === "string" ? raw.session : "UNKNOWN", duration: typeof raw.duration === "string" ? raw.duration : "UNKNOWN", strategy: ownStrategy, legCount: legs.length,
        limitPrice: optionalPositive(raw.price), stopPrice: optionalPositive(raw.stopPrice),
        positionEffect: typeof leg.positionEffect === "string" ? leg.positionEffect : "UNKNOWN",
        orderType: typeof raw.orderType === "string" ? raw.orderType : "UNKNOWN",
        parentOrderId: parentId,
        ocoGroupId: groupId,
      }
      orders.set(`${id}:${item.symbol}`, order)
    }
  }
  const children = Array.isArray(raw.childOrderStrategies) ? raw.childOrderStrategies : []
  for (const childValue of children) {
    if (!childValue || typeof childValue !== "object" || Array.isArray(childValue)) { incomplete(); continue }
    const child = childValue as Record<string, unknown>
    const childId = String(child.orderId ?? child.orderID ?? id)
    visitOrder(child, ownStrategy === "OCO" ? parentId : id || parentId, groupId, orders, fills, fillCutoff, incomplete)
  }
}

function collectFills(raw: Record<string, unknown>, leg: Record<string, unknown>, orderId: string, symbol: string, side: "buy" | "sell", fills: Map<string, BrokerFill>, cutoff: number): void {
  const activities = Array.isArray(raw.orderActivityCollection) ? raw.orderActivityCollection : []
  for (const activityValue of activities) {
    if (!activityValue || typeof activityValue !== "object") continue
    const activity = activityValue as Record<string, unknown>
    if (activity.activityType !== "EXECUTION" || activity.executionType !== "FILL" || !Array.isArray(activity.executionLegs)) continue
    for (const fillValue of activity.executionLegs) {
      if (!fillValue || typeof fillValue !== "object") continue
      const fill = fillValue as Record<string, unknown>
      if (fill.legId !== undefined && leg.legId !== undefined && String(fill.legId) !== String(leg.legId)) continue
      const time = typeof fill.time === "string" ? Date.parse(fill.time) : NaN
      const quantity = optionalPositive(fill.quantity)
      const price = optionalPositive(fill.price)
      if (!Number.isFinite(time) || time < cutoff || quantity === null || price === null) continue
      const fillId = typeof fill.executionId === "string" || typeof fill.executionId === "number"
        ? String(fill.executionId)
        : createHash("sha256").update(`${orderId}|${fill.legId ?? ""}|${fill.time}|${quantity}|${price}`).digest("hex")
      fills.set(fillId, { fillId, orderId: orderId || null, symbol: symbol.toUpperCase(), side, quantity, price, filledAt: new Date(time).toISOString() })
    }
  }
}

function normalizeStatus(value: string): BrokerWorkingOrder["status"] {
  switch (value.toUpperCase()) {
    case "PENDING_ACTIVATION": case "QUEUED": case "WORKING": case "AWAITING_PARENT_ORDER": return "working"
    case "PARTIALLY_FILLED": return "partially-filled"
    case "PENDING_CANCEL": case "PENDING_REPLACE": return "cancel-pending"
    case "FILLED": return "filled"
    case "CANCELED": case "CANCELLED": return "canceled"
    case "REPLACED": return "replaced"
    case "REJECTED": return "rejected"
    case "EXPIRED": return "expired"
    default: return "unknown"
  }
}
function isWorking(status: BrokerWorkingOrder["status"]): boolean { return ["working", "partially-filled", "cancel-pending", "unknown"].includes(status) }
function optionalPositive(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null }
function optionalNonnegative(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null }
function safeMessage(error: unknown): string { return (error instanceof Error ? error.message : "Schwab order read failed").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240) }

