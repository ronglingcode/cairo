export type IsoTimestamp = string
export type NanoTimestamp = string

export type SourceKind = "chart" | "bookmap" | "broker" | "copilot"
export type SourceState = "connected" | "disconnected" | "stale" | "waiting" | "unknown"

export interface SourceStatus {
  source: SourceKind
  state: SourceState
  updatedAt: IsoTimestamp | null
  detail: string | null
}

export interface ChartBar {
  /** Unix time in milliseconds at the start of the minute. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ChartSnapshot {
  symbol: string
  interval: "1m"
  fetchedAt: IsoTimestamp
  latestBarAt: IsoTimestamp | null
  bars: ChartBar[]
  source: SourceStatus
}

export type ObservationMode = "live" | "replay" | "unknown"
export type ObservationReadiness = "ready" | "not-ready" | "unknown"
export type ObservationDelivery = "snapshot" | "live"

export interface BookmapObservation {
  sourceInstanceId: string
  sequence: number
  symbol: { source: string; canonical: string }
  priceUnit: "USD"
  episodeId: string
  revision: number
  pattern: string
  price: number | null
  eventTime: NanoTimestamp | null
  receivedAt: NanoTimestamp
  detectorRevision: string | null
  configRevision: string | null
  mode: ObservationMode
  readiness: ObservationReadiness
  delivery: ObservationDelivery
  kind: "episode" | "heartbeat" | "reset"
}

export interface BrokerPosition {
  positionId: string
  symbol: string
  side: "long" | "short"
  quantity: number
  averagePrice: number
  markPrice: number | null
  markUpdatedAt?: IsoTimestamp | null
  markSource?: string | null
}

export interface BrokerWorkingOrder {
  orderId: string
  symbol: string
  side: "buy" | "sell"
  quantity: number
  status: "working" | "partially-filled" | "cancel-pending" | "filled" | "canceled" | "replaced" | "rejected" | "expired" | "unknown"
  orderType: string
  parentOrderId: string | null
  ocoGroupId: string | null
  filledQuantity?: number
  brokerStatus?: string
  positionEffect?: string
  instruction?: string
  session?: string
  duration?: string
  strategy?: string
  legCount?: number
  limitPrice?: number | null
  stopPrice?: number | null
}

export interface BrokerFill {
  fillId: string
  orderId: string | null
  symbol: string
  side: "buy" | "sell"
  quantity: number
  price: number
  filledAt: IsoTimestamp
}

export interface BrokerFacts {
  accountId: string
  asOf: IsoTimestamp
  positions: BrokerPosition[]
  workingOrders: BrokerWorkingOrder[]
  recentFills: BrokerFill[]
  ordersComplete: boolean
  accountAvailability?: AccountAvailability
  source: SourceStatus
}

export interface AccountAvailability {
  liquidationValue: number | null
  buyingPower: number | null
  updatedAt: IsoTimestamp
}

export type ClauseCoverage = "deterministic" | "human" | "advisory" | "unsupported"

export interface InterpretationClause {
  clauseId: string
  sourceText: string
  coverage: ClauseCoverage
  explanation: string
  mandatory?: boolean
}

export interface TradebookInterpretation {
  tradebookId: string
  narrativeHash: string
  clauses: InterpretationClause[]
  management?: import("../engine/ManagementPolicy.mts").ManagementPolicy
}

export interface Tradebook {
  id: string
  activeSides?: ("long" | "short")[]
  title: string
  markdown: string
  revision: string
  contentHash: string
  interpretation: TradebookInterpretation | null
}

export interface PositionAttachment {
  id: string
  accountId: string
  symbol: string
  positionId: string
  tradebookId: string
  tradebookRevision: string
  narrativeHash: string
  interpretation: TradebookInterpretation
  state: "pending-confirmation" | "active" | "paused" | "closed"
  markdown?: string
  revision?: string
  initialQuantity?: number
  baseline?: { quantity: number; averagePrice: number; side: "long" | "short"; fillIds: string[] }
  pauseReason?: string | null
  reviewedAt?: string
  remainingAllocations?: Record<string, number>
}

export type ExitAction = "close" | "cancel-protection" | "replace-protection"

export interface ExitOrderShape {
  orderType: "market" | "limit" | "stop" | "stop-limit"
  quantity: number
  limitPrice: number | null
  stopPrice: number | null
  duration: "DAY"
}

export interface ExitTicket {
  reviewHash?: string
  positionId?: string
  createdAt?: string
  runtimeInstanceId?: string
  factsRevision?: number
  factsFingerprint?: string
  recommendationId?: string | null
  attachmentRevision?: string | null
  origin?: "trader" | "copilot"
  exactPayload?: import("../engine/ExitPayload.mts").EquityExitPayload | null
  affectedOrders?: BrokerWorkingOrder[]
  id: string
  accountId: string
  symbol: string
  positionSide: "long" | "short"
  action: ExitAction
  quantity: number
  orderId: string | null
  request: ExitOrderShape | null
  reason: string
  sourceClauseId: string | null
  expiresAt: IsoTimestamp
  state: "staged" | "dismissed" | "invalidated" | "approved"
}

export interface TradebookAssignment { symbol: string; side: "long" | "short"; tradebookId: string }

export interface PreparationNotes {
  tradebookAssignments?: TradebookAssignment[]
  markdown: string
  date: string | null
  symbol: string | null
  revision: string
  savedAt: IsoTimestamp
}

export interface CopilotChatMessage {
  id: string
  createdAt?: number
  role: "user" | "assistant"
  text: string
  tools: Array<{ name: string; state: string; error?: string }>
}

export interface CopilotChat {
  sessionId: string | null
  model: string
  fake: boolean
  connected: boolean
  busy: boolean
  error: string | null
  outcome: string | null
  messages: CopilotChatMessage[]
  truncated: boolean
}

export interface CairoSnapshot {
  bookmapPatternTags: import("./BookmapPatterns.mts").BookmapPatternTag[]
  bookmapPatternPicker: import("./BookmapPatterns.mts").BookmapPatternPicker | null
  bookmapPatternError: string | null
  observationAttempts: import("../engine/EntryObserver.mts").ObservationAttempt[]
  bookmapEvidence: import("../engine/BookmapEvidence.mts").BookmapEvidenceProjection
  bookmapProjection: import("../engine/BookmapReceiver.mts").BookmapProjection
  protectionReadback: import("../engine/ProtectionCoordinator.mts").ProtectionReadback[]
  brokerAttempts: import("../engine/RecoveryStore.mts").BrokerAttempt[]
  recoveryError: string | null
  executionReady: boolean
  runtimeInstanceId: string
  sequence: number
  brokerFactsRevision: number
  brokerRefreshSequence: number
  chart: ChartSnapshot | null
  preparation: PreparationNotes | null
  preparationError: string | null
  bookmap: SourceStatus
  broker: SourceStatus
  brokerFacts: BrokerFacts | null
  copilot: SourceStatus
  copilotWake: import("../copilot/CopilotWaker.mts").WakeStatus
  copilotChat: CopilotChat | null
  copilotAutomaticChat: CopilotChat | null
  copilotAccountChat: CopilotChat | null
  copilotManagementChat: CopilotChat | null
  copilotPartialManagement: import("../copilot/PartialManagement.mts").PartialManagementStatus
  positions: BrokerPosition[]
  tradebooks: Tradebook[]
  attachments: PositionAttachment[]
  tickets: ExitTicket[]
  management: import("../engine/ManagementMonitor.mts").RuleReadback[]
  noteProposals: import("../copilot/CairoDomainTools.mts").NoteProposal[]
  guidanceProposals: import("../engine/GuidanceProposals.mts").GuidanceProposal[]
  managementTimeline: import("../engine/ManagementTimeline.mts").ManagementEvent[]
  recommendations: import("../engine/ManagementMonitor.mts").ManagementRecommendation[]
}

export interface EngineEvent {
  runtimeInstanceId: string
  sequence: number
  changes: Partial<Omit<CairoSnapshot, "runtimeInstanceId" | "sequence">>
}

export interface Clock {
  now(): number
}

export interface HttpResponse {
  headers?: Record<string, string>
  status: number
  body: unknown
}

export interface HttpPort {
  request(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<HttpResponse>
}

export interface BrokerPort {
  readAccount(accountId: string): Promise<BrokerFacts>
}

export interface ObservationHandlers {
  onObservation(observation: BookmapObservation): void
  onStatus(status: SourceStatus): void
}

export interface ObservationPort {
  subscribe(handlers: ObservationHandlers): Promise<() => void>
}

export class ContractError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(`${field}: ${message}`)
    this.name = "ContractError"
    this.field = field
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractError(field, "expected an object")
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, nonEmpty = true): string {
  if (typeof value !== "string" || (nonEmpty && value.trim().length === 0)) {
    throw new ContractError(field, "expected a string")
  }
  return value
}

function finite(value: unknown, field: string, min = -Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new ContractError(field, "expected a finite number in range")
  }
  return value
}

function isoTimestamp(value: unknown, field: string): IsoTimestamp {
  const result = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new ContractError(field, "expected an ISO-8601 timestamp with timezone")
  }
  return result
}

function nanoTimestamp(value: unknown, field: string, nullable = false): NanoTimestamp | null {
  if (nullable && value === null) return null
  if (typeof value !== "string" || !/^\d{1,30}$/.test(value)) {
    throw new ContractError(field, "expected nanoseconds as a digit string")
  }
  return value
}

function enumValue<const T extends readonly string[]>(value: unknown, choices: T, field: string): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new ContractError(field, `expected one of ${choices.join(", ")}`)
  }
  return value as T[number]
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field)
}

function sourceStatus(value: unknown, field: string): SourceStatus {
  const item = record(value, field)
  return {
    source: enumValue(item.source, ["chart", "bookmap", "broker", "copilot"] as const, `${field}.source`),
    state: enumValue(item.state, ["connected", "disconnected", "stale", "waiting", "unknown"] as const, `${field}.state`),
    updatedAt: item.updatedAt === null ? null : isoTimestamp(item.updatedAt, `${field}.updatedAt`),
    detail: nullableText(item.detail, `${field}.detail`),
  }
}

export function parseChartSnapshot(value: unknown): ChartSnapshot {
  const item = record(value, "chart")
  if (!Array.isArray(item.bars)) throw new ContractError("chart.bars", "expected an array")
  const bars = item.bars.map((raw, index): ChartBar => {
    const bar = record(raw, `chart.bars[${index}]`)
    const parsed: ChartBar = {
      time: finite(bar.time, `chart.bars[${index}].time`, 0),
      open: finite(bar.open, `chart.bars[${index}].open`, 0),
      high: finite(bar.high, `chart.bars[${index}].high`, 0),
      low: finite(bar.low, `chart.bars[${index}].low`, 0),
      close: finite(bar.close, `chart.bars[${index}].close`, 0),
      volume: finite(bar.volume, `chart.bars[${index}].volume`, 0),
    }
    if (parsed.high < Math.max(parsed.open, parsed.close, parsed.low) || parsed.low > Math.min(parsed.open, parsed.close, parsed.high)) {
      throw new ContractError(`chart.bars[${index}]`, "inconsistent OHLC range")
    }
    return parsed
  })

  return {
    symbol: text(item.symbol, "chart.symbol").toUpperCase(),
    interval: enumValue(item.interval, ["1m"] as const, "chart.interval"),
    fetchedAt: isoTimestamp(item.fetchedAt, "chart.fetchedAt"),
    latestBarAt: item.latestBarAt === null ? null : isoTimestamp(item.latestBarAt, "chart.latestBarAt"),
    bars,
    source: sourceStatus(item.source, "chart.source"),
  }
}

export function parseBookmapObservation(value: unknown): BookmapObservation {
  const item = record(value, "observation")
  const symbol = record(item.symbol, "observation.symbol")
  const price = item.price === null ? null : finite(item.price, "observation.price", 0)
  const observation: BookmapObservation = {
    sourceInstanceId: text(item.sourceInstanceId, "observation.sourceInstanceId"),
    sequence: finite(item.sequence, "observation.sequence", 0),
    symbol: { source: text(symbol.source, "observation.symbol.source"), canonical: text(symbol.canonical, "observation.symbol.canonical").toUpperCase() },
    priceUnit: enumValue(item.priceUnit, ["USD"] as const, "observation.priceUnit"),
    episodeId: text(item.episodeId, "observation.episodeId"),
    revision: finite(item.revision, "observation.revision", 0),
    pattern: text(item.pattern, "observation.pattern"),
    price,
    eventTime: nanoTimestamp(item.eventTime, "observation.eventTime", true),
    receivedAt: nanoTimestamp(item.receivedAt, "observation.receivedAt") as string,
    detectorRevision: nullableText(item.detectorRevision, "observation.detectorRevision"),
    configRevision: nullableText(item.configRevision, "observation.configRevision"),
    mode: enumValue(item.mode, ["live", "replay", "unknown"] as const, "observation.mode"),
    readiness: enumValue(item.readiness, ["ready", "not-ready", "unknown"] as const, "observation.readiness"),
    delivery: enumValue(item.delivery, ["snapshot", "live"] as const, "observation.delivery"),
    kind: enumValue(item.kind, ["episode", "heartbeat", "reset"] as const, "observation.kind"),
  }
  if (!Number.isInteger(observation.sequence) || !Number.isInteger(observation.revision)) {
    throw new ContractError("observation", "sequence and revision must be integers")
  }
  return observation
}

export function parseBrokerFacts(value: unknown): BrokerFacts {
  const item = record(value, "brokerFacts")
  if (!Array.isArray(item.positions) || !Array.isArray(item.workingOrders) || !Array.isArray(item.recentFills)) {
    throw new ContractError("brokerFacts", "positions, workingOrders, and recentFills arrays are required")
  }
  const positions = item.positions.map((raw, index): BrokerPosition => {
    const p = record(raw, `brokerFacts.positions[${index}]`)
    return {
      positionId: text(p.positionId, `brokerFacts.positions[${index}].positionId`),
      symbol: text(p.symbol, `brokerFacts.positions[${index}].symbol`).toUpperCase(),
      side: enumValue(p.side, ["long", "short"] as const, `brokerFacts.positions[${index}].side`),
      quantity: finite(p.quantity, `brokerFacts.positions[${index}].quantity`, Number.MIN_VALUE),
      averagePrice: finite(p.averagePrice, `brokerFacts.positions[${index}].averagePrice`, Number.MIN_VALUE),
      markPrice: p.markPrice === null ? null : finite(p.markPrice, `brokerFacts.positions[${index}].markPrice`, Number.MIN_VALUE),
      ...(p.markUpdatedAt === undefined ? {} : { markUpdatedAt: p.markUpdatedAt === null ? null : isoTimestamp(p.markUpdatedAt, `brokerFacts.positions[${index}].markUpdatedAt`) }),
      ...(p.markSource === undefined ? {} : { markSource: nullableText(p.markSource, `brokerFacts.positions[${index}].markSource`) }),
    }
  })
  const workingOrders = item.workingOrders.map((raw, index): BrokerWorkingOrder => {
    const o = record(raw, `brokerFacts.workingOrders[${index}]`)
    return {
      orderId: text(o.orderId, `brokerFacts.workingOrders[${index}].orderId`),
      symbol: text(o.symbol, `brokerFacts.workingOrders[${index}].symbol`).toUpperCase(),
      side: enumValue(o.side, ["buy", "sell"] as const, `brokerFacts.workingOrders[${index}].side`),
      quantity: finite(o.quantity, `brokerFacts.workingOrders[${index}].quantity`, Number.MIN_VALUE),
      status: enumValue(o.status, ["working", "partially-filled", "cancel-pending", "filled", "canceled", "replaced", "rejected", "expired", "unknown"] as const, `brokerFacts.workingOrders[${index}].status`),
      orderType: text(o.orderType, `brokerFacts.workingOrders[${index}].orderType`),
      parentOrderId: nullableText(o.parentOrderId, `brokerFacts.workingOrders[${index}].parentOrderId`),
      ocoGroupId: nullableText(o.ocoGroupId, `brokerFacts.workingOrders[${index}].ocoGroupId`),
      ...(o.filledQuantity === undefined ? {} : { filledQuantity: finite(o.filledQuantity, `brokerFacts.workingOrders[${index}].filledQuantity`, 0) }),
      ...(o.brokerStatus === undefined ? {} : { brokerStatus: text(o.brokerStatus, `brokerFacts.workingOrders[${index}].brokerStatus`) }),
      ...(o.positionEffect === undefined ? {} : { positionEffect: text(o.positionEffect, `brokerFacts.workingOrders[${index}].positionEffect`) }),
      ...Object.fromEntries(["instruction", "session", "duration", "strategy"].filter(key => o[key] !== undefined).map(key => [key, text(o[key], `brokerFacts.workingOrders[${index}].${key}`)])),
      ...(o.legCount === undefined ? {} : { legCount: finite(o.legCount, "order.legCount", 1) }),
      ...Object.fromEntries(["limitPrice", "stopPrice"].filter(key => o[key] !== undefined).map(key => [key, o[key] === null ? null : finite(o[key], `order.${key}`, Number.MIN_VALUE)])),
    }
  })
  const recentFills = item.recentFills.map((raw, index): BrokerFill => {
    const f = record(raw, `brokerFacts.recentFills[${index}]`)
    return {
      fillId: text(f.fillId, `brokerFacts.recentFills[${index}].fillId`),
      orderId: nullableText(f.orderId, `brokerFacts.recentFills[${index}].orderId`),
      symbol: text(f.symbol, `brokerFacts.recentFills[${index}].symbol`).toUpperCase(),
      side: enumValue(f.side, ["buy", "sell"] as const, `brokerFacts.recentFills[${index}].side`),
      quantity: finite(f.quantity, `brokerFacts.recentFills[${index}].quantity`, Number.MIN_VALUE),
      price: finite(f.price, `brokerFacts.recentFills[${index}].price`, Number.MIN_VALUE),
      filledAt: isoTimestamp(f.filledAt, `brokerFacts.recentFills[${index}].filledAt`),
    }
  })
  if (typeof item.ordersComplete !== "boolean") throw new ContractError("brokerFacts.ordersComplete", "expected a boolean")
  let accountAvailability: AccountAvailability | undefined
  if (item.accountAvailability !== undefined) {
    const a = record(item.accountAvailability, "brokerFacts.accountAvailability")
    accountAvailability = {
      liquidationValue: a.liquidationValue === null ? null : finite(a.liquidationValue, "brokerFacts.accountAvailability.liquidationValue"),
      buyingPower: a.buyingPower === null ? null : finite(a.buyingPower, "brokerFacts.accountAvailability.buyingPower"),
      updatedAt: isoTimestamp(a.updatedAt, "brokerFacts.accountAvailability.updatedAt"),
    }
  }
  return {
    accountId: text(item.accountId, "brokerFacts.accountId"),
    asOf: isoTimestamp(item.asOf, "brokerFacts.asOf"),
    positions,
    workingOrders,
    recentFills,
    ordersComplete: item.ordersComplete,
    ...(accountAvailability === undefined ? {} : { accountAvailability }),
    source: sourceStatus(item.source, "brokerFacts.source"),
  }
}

export function parseExitTicket(value: unknown): ExitTicket {
  const item = record(value, "ticket")
  let request: ExitOrderShape | null = null
  if (item.request !== null) {
    const raw = record(item.request, "ticket.request")
    request = {
      orderType: enumValue(raw.orderType, ["market", "limit", "stop", "stop-limit"] as const, "ticket.request.orderType"),
      quantity: finite(raw.quantity, "ticket.request.quantity", Number.MIN_VALUE),
      limitPrice: raw.limitPrice === null ? null : finite(raw.limitPrice, "ticket.request.limitPrice", Number.MIN_VALUE),
      stopPrice: raw.stopPrice === null ? null : finite(raw.stopPrice, "ticket.request.stopPrice", Number.MIN_VALUE),
      duration: enumValue(raw.duration, ["DAY"] as const, "ticket.request.duration"),
    }
  }
  const quantity = finite(item.quantity, "ticket.quantity", Number.MIN_VALUE)
  return {
    id: text(item.id, "ticket.id"),
    accountId: text(item.accountId, "ticket.accountId"),
    symbol: text(item.symbol, "ticket.symbol").toUpperCase(),
    positionSide: enumValue(item.positionSide, ["long", "short"] as const, "ticket.positionSide"),
    action: enumValue(item.action, ["close", "cancel-protection", "replace-protection"] as const, "ticket.action"),
    quantity,
    orderId: nullableText(item.orderId, "ticket.orderId"),
    request,
    reason: text(item.reason, "ticket.reason"),
    sourceClauseId: nullableText(item.sourceClauseId, "ticket.sourceClauseId"),
    expiresAt: isoTimestamp(item.expiresAt, "ticket.expiresAt"),
    state: enumValue(item.state, ["staged", "dismissed", "invalidated", "approved"] as const, "ticket.state"),
  }
}

export class FakeClock implements Clock {
  private currentTime: number
  constructor(currentTime: number) { this.currentTime = currentTime }
  now(): number { return this.currentTime }
  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError("advance must be a finite nonnegative duration")
    this.currentTime += milliseconds
  }
}

export class FakeHttp implements HttpPort {
  readonly requests: Array<{ url: string; method: string; body?: string }> = []
  private responses: HttpResponse[] = []

  enqueue(response: HttpResponse): void { this.responses.push(response) }

  async request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<HttpResponse> {
    this.requests.push({ url, method: init.method ?? "GET", ...(init.body === undefined ? {} : { body: init.body }) })
    const response = this.responses.shift()
    if (!response) throw new Error("FakeHttp has no queued response")
    return response
  }
}

export class FakeBroker implements BrokerPort {
  readonly accountReads: string[] = []
  private facts: BrokerFacts
  constructor(facts: BrokerFacts) { this.facts = facts }
  setFacts(facts: BrokerFacts): void { this.facts = facts }
  async readAccount(accountId: string): Promise<BrokerFacts> {
    this.accountReads.push(accountId)
    if (accountId !== this.facts.accountId) throw new Error("FakeBroker account mismatch")
    return structuredClone(this.facts)
  }
}

export class FakeObservationSource implements ObservationPort {
  private handlers = new Set<ObservationHandlers>()
  async subscribe(handlers: ObservationHandlers): Promise<() => void> {
    this.handlers.add(handlers)
    handlers.onStatus({ source: "bookmap", state: "connected", updatedAt: new Date(0).toISOString(), detail: "synthetic feed" })
    return () => this.handlers.delete(handlers)
  }
  emit(observation: BookmapObservation): void {
    for (const handler of this.handlers) handler.onObservation(structuredClone(observation))
  }
  setStatus(status: SourceStatus): void {
    for (const handler of this.handlers) handler.onStatus(structuredClone(status))
  }
  get subscriberCount(): number { return this.handlers.size }
}





