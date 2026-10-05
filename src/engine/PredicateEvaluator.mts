import type { CairoSnapshot, BrokerPosition } from "../shared/contracts.mts"

export type EvaluationState = "satisfied" | "pending" | "invalid" | "unknown"
export type Comparison = "gt" | "gte" | "lt" | "lte" | "eq"
export type Predicate =
  | { kind: "scalar"; left: number; operator: Comparison; right: number }
  | { kind: "compare"; field: "position.quantity" | "position.averagePrice" | "broker.markPrice" | "chart.lastClose"; operator: Comparison; value: number }
  | { kind: "all" | "any"; conditions: Predicate[] }
  | { kind: "broker-fill"; orderId: string; side: "buy" | "sell"; minimumQuantity: number; since: string }
  | { kind: "human"; conditionId: string }
  | { kind: "live-price" | "bookmap"; conditionId: string }

export interface PredicateScope {
  accountId: string
  positionId: string
  symbol: string
  attachmentId: string
  interpretationRevision: string
}
export interface HumanConfirmation {
  scope: PredicateScope
  runtimeInstanceId: string
  brokerFactsRevision: number
  conditionId: string
  confirmedAt: string
  expiresAt: string
  value: boolean
}
export interface EvaluationContext {
  snapshot: CairoSnapshot
  scope: PredicateScope
  now: number
  purpose?: "monitoring" | "historical-context"
  confirmations?: HumanConfirmation[]
}
export interface PredicateEvidence {
  source: "literal" | "broker" | "chart" | "human" | "unavailable" | "validation"
  state: EvaluationState
  reason: string
  sourceAt: string | null
  observed?: number | boolean
  factsRevision?: number
  historical?: boolean
}
export interface PredicateResult {
  state: EvaluationState
  /** Evidence eligibility only. Never broker approval or an execution instruction. */
  actionEligible: boolean
  evidence: PredicateEvidence[]
}

const MAX_BROKER_AGE_MS = 60_000
const MAX_CONFIRMATION_MS = 5 * 60_000
const MAX_FILL_LOOKBACK_MS = 7 * 24 * 60 * 60_000
const fields = ["position.quantity", "position.averagePrice", "broker.markPrice", "chart.lastClose"]
const operators = ["gt", "gte", "lt", "lte", "eq"]
const scopeKeys = ["accountId", "positionId", "symbol", "attachmentId", "interpretationRevision"] as const

/** Bounded typed grammar. Unknown fields and malformed nodes are never evaluated as code. */
export function validatePredicate(value: unknown): Predicate {
  let nodes = 0
  const visit = (raw: unknown, depth: number): Predicate => {
    if (++nodes > 64 || depth > 8 || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Predicate exceeds the supported shape or size")
    const item = raw as Record<string, unknown>
    const exact = (names: string[]) => { if (Object.keys(item).some(key => !names.includes(key)) || names.some(key => !(key in item))) throw new Error("Unexpected or missing predicate fields") }
    const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v)
    const identifier = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 200
    if (item.kind === "all" || item.kind === "any") {
      exact(["kind", "conditions"])
      if (!Array.isArray(item.conditions) || !item.conditions.length || item.conditions.length > 16) throw new Error("Group needs 1–16 conditions")
      return { kind: item.kind, conditions: item.conditions.map(child => visit(child, depth + 1)) }
    }
    if (item.kind === "scalar") {
      exact(["kind", "left", "operator", "right"])
      if (!finite(item.left) || !finite(item.right) || !operators.includes(String(item.operator))) throw new Error("Scalar comparison is invalid")
    } else if (item.kind === "compare") {
      exact(["kind", "field", "operator", "value"])
      if (!finite(item.value) || !fields.includes(String(item.field)) || !operators.includes(String(item.operator))) throw new Error("Source comparison is invalid")
    } else if (item.kind === "broker-fill") {
      exact(["kind", "orderId", "side", "minimumQuantity", "since"])
      if (!identifier(item.orderId) || !["buy", "sell"].includes(String(item.side)) || !finite(item.minimumQuantity) || Number(item.minimumQuantity) <= 0 || typeof item.since !== "string" || !Number.isFinite(Date.parse(item.since))) throw new Error("Fill condition needs an order, side, quantity and source time")
    } else if (["human", "live-price", "bookmap"].includes(String(item.kind))) {
      exact(["kind", "conditionId"])
      if (!identifier(item.conditionId)) throw new Error("Condition identity is invalid")
    } else throw new Error("Unsupported predicate grammar")
    return structuredClone(item) as Predicate
  }
  return visit(value, 0)
}

function result(state: EvaluationState, evidence: Omit<PredicateEvidence, "state">, eligible = state === "satisfied"): PredicateResult {
  return { state, actionEligible: eligible && state === "satisfied", evidence: [{ ...evidence, state }] }
}
function compare(left: number, operator: Comparison, right: number): boolean {
  switch (operator) { case "gt": return left > right; case "gte": return left >= right; case "lt": return left < right; case "lte": return left <= right; case "eq": return left === right }
}
function fresh(timestamp: string | null | undefined, now: number, maxAge = MAX_BROKER_AGE_MS): boolean {
  const time = timestamp ? Date.parse(timestamp) : NaN
  return Number.isFinite(time) && time <= now && now - time <= maxAge
}

export function evaluatePredicate(input: unknown, context: EvaluationContext): PredicateResult {
  let predicate: Predicate
  try { predicate = validatePredicate(input) } catch (error) {
    return result("invalid", { source: "validation", reason: error instanceof Error ? error.message : "Invalid condition", sourceAt: null })
  }
  const { snapshot, scope, now } = context
  if (!Number.isFinite(now) || !scope || scopeKeys.some(key => typeof scope[key] !== "string" || !scope[key])) return result("invalid", { source: "validation", reason: "Evaluation needs a clock and complete position/interpretation scope", sourceAt: null })
  if (context.purpose !== undefined && !["monitoring", "historical-context"].includes(context.purpose)) return result("invalid", { source: "validation", reason: "Unknown evaluation purpose", sourceAt: null })
  const broker = (): BrokerPosition | PredicateResult => {
    const facts = snapshot.brokerFacts
    if (!facts || facts.accountId !== scope.accountId) return result("unknown", { source: "broker", reason: "Selected account facts are unavailable", sourceAt: facts?.asOf ?? null })
    if (snapshot.broker.state !== "connected" || facts.source.state !== "connected" || !fresh(facts.asOf, now) || !fresh(facts.source.updatedAt, now)) return result("unknown", { source: "broker", reason: "Broker facts are stale or disconnected", sourceAt: facts.asOf, factsRevision: snapshot.brokerFactsRevision })
    const position = facts.positions.find(value => value.positionId === scope.positionId && value.symbol === scope.symbol)
    if (!position) return result("unknown", { source: "broker", reason: "This position is absent from current account facts", sourceAt: facts.asOf })
    if (!Number.isFinite(position.quantity) || position.quantity <= 0) return result("invalid", { source: "broker", reason: "Current position quantity is invalid", sourceAt: facts.asOf })
    return position
  }
  const evaluate = (node: Predicate): PredicateResult => {
    if (node.kind === "all" || node.kind === "any") {
      const children = node.conditions.map(evaluate)
      const state: EvaluationState = children.some(child => child.state === "invalid") ? "invalid" :
        node.kind === "any" && children.some(child => child.state === "satisfied") ? "satisfied" :
        children.some(child => child.state === "unknown") ? "unknown" :
        node.kind === "all" ? children.every(child => child.state === "satisfied") ? "satisfied" : "pending" : "pending"
      return { state, actionEligible: state === "satisfied" && (node.kind === "all" ? children.every(child => child.actionEligible) : children.some(child => child.actionEligible)), evidence: children.flatMap(child => child.evidence) }
    }
    if (node.kind === "live-price" || node.kind === "bookmap") return result("unknown", { source: "unavailable", reason: `${node.kind} conditions have no supported current source in this phase`, sourceAt: null })
    if (node.kind === "scalar") return result(compare(node.left, node.operator, node.right) ? "satisfied" : "pending", { source: "literal", reason: "Explicit finite scalar comparison", sourceAt: null, observed: node.left }, context.purpose !== "historical-context")
    if (node.kind === "compare" && node.field === "chart.lastClose") {
      const chart = snapshot.chart
      if (!chart || chart.symbol !== scope.symbol || !chart.bars.length) return result("unknown", { source: "chart", reason: "Matching chart snapshot is unavailable", sourceAt: chart?.latestBarAt ?? null, historical: true })
      if (context.purpose !== "historical-context") return result("unknown", { source: "chart", reason: "REST bars cannot establish a current condition, touch or crossing", sourceAt: chart.latestBarAt, historical: true })
      const value = chart.bars.at(-1)!.close
      if (!Number.isFinite(value)) return result("invalid", { source: "chart", reason: "Chart close is invalid", sourceAt: chart.latestBarAt, historical: true })
      return result(compare(value, node.operator, node.value) ? "satisfied" : "pending", { source: "chart", reason: `Historical context only; fetched ${chart.fetchedAt}`, sourceAt: chart.latestBarAt, observed: value, historical: true }, false)
    }
    const position = broker()
    if ("state" in position) return position
    const facts = snapshot.brokerFacts!
    if (node.kind === "compare") {
      const value = node.field === "position.quantity" ? position.quantity : node.field === "position.averagePrice" ? position.averagePrice : position.markPrice
      if (node.field === "broker.markPrice" && !fresh(position.markUpdatedAt, now)) return result("unknown", { source: "broker", reason: "Broker mark time is missing or stale; it is not a live quote", sourceAt: position.markUpdatedAt ?? null })
      if (value === null || !Number.isFinite(value)) return result("unknown", { source: "broker", reason: "Requested broker scalar is unavailable", sourceAt: facts.asOf })
      return result(compare(value, node.operator, node.value) ? "satisfied" : "pending", { source: "broker", reason: node.field === "broker.markPrice" ? "Current reported broker mark comparison, not a live crossing" : "Current broker position fact", sourceAt: node.field === "broker.markPrice" ? position.markUpdatedAt! : facts.asOf, observed: value, factsRevision: snapshot.brokerFactsRevision }, context.purpose !== "historical-context")
    }
    if (node.kind === "broker-fill") {
      const since = Date.parse(node.since)
      if (since > now || now - since > MAX_FILL_LOOKBACK_MS) return result("unknown", { source: "broker", reason: "Fill condition is outside the bounded recent-fill window", sourceAt: facts.asOf })
      const matching = facts.recentFills.filter(fill => fill.orderId === node.orderId && fill.symbol === scope.symbol && fill.side === node.side && Date.parse(fill.filledAt) >= since && Date.parse(fill.filledAt) <= now)
      if (facts.recentFills.some(fill => fill.orderId === node.orderId && fill.symbol === scope.symbol && (!Number.isFinite(Date.parse(fill.filledAt)) || Date.parse(fill.filledAt) > now))) return result("unknown", { source: "broker", reason: "Relevant fill timestamps are missing or ahead of the evaluation clock", sourceAt: facts.asOf })
      if (matching.some(fill => !Number.isFinite(fill.quantity) || fill.quantity <= 0)) return result("invalid", { source: "broker", reason: "Reported fill quantity is invalid", sourceAt: facts.asOf })
      const unique = new Map(matching.map(fill => [fill.fillId, fill]))
      if (matching.some(fill => JSON.stringify(fill) !== JSON.stringify(unique.get(fill.fillId)))) return result("invalid", { source: "broker", reason: "Conflicting reports for the same fill identity", sourceAt: facts.asOf })
      const quantity = [...unique.values()].reduce((sum, fill) => sum + fill.quantity, 0)
      if (!Number.isFinite(quantity)) return result("invalid", { source: "broker", reason: "Aggregated fill quantity is invalid", sourceAt: facts.asOf })
      if (quantity < node.minimumQuantity && (!facts.ordersComplete || facts.recentFills.length >= 1000)) return result("unknown", { source: "broker", reason: "Recent order/fill coverage is incomplete", sourceAt: facts.asOf, observed: quantity })
      return result(quantity >= node.minimumQuantity ? "satisfied" : "pending", { source: "broker", reason: "Actual broker fills for the scoped symbol/order; an accepted order is not a fill", sourceAt: facts.asOf, observed: quantity, factsRevision: snapshot.brokerFactsRevision }, context.purpose !== "historical-context")
    }
    if (node.kind === "human") {
      const confirmation = context.confirmations?.slice(-100).reverse().find(value => value && value.scope && value.conditionId === node.conditionId && value.runtimeInstanceId === snapshot.runtimeInstanceId && value.brokerFactsRevision === snapshot.brokerFactsRevision && scopeKeys.every(key => value.scope[key] === scope[key]))
      if (!confirmation || !fresh(confirmation.confirmedAt, now, MAX_CONFIRMATION_MS) || !Number.isFinite(Date.parse(confirmation.expiresAt)) || Date.parse(confirmation.expiresAt) <= now || Date.parse(confirmation.expiresAt) - Date.parse(confirmation.confirmedAt) > MAX_CONFIRMATION_MS || typeof confirmation.value !== "boolean") return result("pending", { source: "human", reason: "Current scoped trader confirmation is needed", sourceAt: confirmation?.confirmedAt ?? null })
      return result(confirmation.value ? "satisfied" : "pending", { source: "human", reason: "Confirmation matches this runtime, account, position, attachment, interpretation, condition and broker revision; it grants no order approval", sourceAt: confirmation.confirmedAt, observed: confirmation.value, factsRevision: snapshot.brokerFactsRevision }, context.purpose !== "historical-context")
    }
    return result("invalid", { source: "validation", reason: "Unsupported predicate", sourceAt: null })
  }
  return evaluate(predicate)
}
