import { createHash } from "node:crypto"
import { validatePredicate, type Predicate } from "./PredicateEvaluator.mts"
import type { TradebookInterpretation } from "../shared/contracts.mts"

export interface QuantityPolicy {
  basis: "shares" | "initial" | "remaining" | "all"
  value?: number
  rounding?: "floor"
  allocationId?: string
}
export interface ManagementAction {
  kind: "close" | "replace-protection"
  quantity: QuantityPolicy
  orderType: "market" | "limit" | "stop" | "stop-limit"
  limitLevel?: string
  stopLevel?: string
  orderId?: string
}
export interface ManagementRule {
  id: string
  clauseId: string
  condition: Predicate
  action: ManagementAction
  recurrence: "once" | "on-rearm"
  dependencies: Array<{ ruleId: string; state: "filled" }>
}
export interface ManagementPolicy {
  version: 1
  levels: Array<{ id: string; value: number; sourceText: string; binding: "attachment" }>
  allocations: Array<{ id: string; shares: number; remainder: boolean }>
  rules: ManagementRule[]
}
export interface PolicyValidation { policy: ManagementPolicy; issues: string[]; monitorable: boolean }
function fail(message: string): never { throw new Error(message) }
function object(input: unknown): Record<string, unknown> { return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : fail("Expected an object") }
function exact(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(key => !(key in value)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) fail("Missing or unsupported policy fields")
}
function id(value: unknown): string { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value) ? value : fail("Invalid policy identity") }
function list(value: unknown, maximum: number): unknown[] { return Array.isArray(value) && value.length <= maximum ? value : fail("Policy list exceeds supported size") }
function positive(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fail("Policy value must be positive and finite") }
function unique(values: string[]): void { if (new Set(values).size !== values.length) fail("Duplicate policy identities") }

export function validateManagementPolicy(input: unknown, interpretation: TradebookInterpretation, markdown: string): PolicyValidation {
  const raw = object(input)
  exact(raw, ["version", "levels", "allocations", "rules"])
  if (raw.version !== 1) fail("Unsupported policy version")
  const clauses = new Map(interpretation.clauses.map(clause => [clause.clauseId, clause]))
  const issues: string[] = []
  const levels = list(raw.levels, 20).map(input => {
    const value = object(input); exact(value, ["id", "value", "sourceText", "binding"])
    if (typeof value.sourceText !== "string" || !value.sourceText.trim() || !markdown.includes(value.sourceText) || value.binding !== "attachment") fail("Level must bind to the authored narrative at attachment")
    return { id: id(value.id), value: positive(value.value), sourceText: value.sourceText, binding: "attachment" as const }
  })
  unique(levels.map(level => level.id))
  const allocations = list(raw.allocations, 20).map(input => {
    const value = object(input); exact(value, ["id", "shares", "remainder"])
    const shares = positive(value.shares)
    if (!Number.isSafeInteger(shares) || typeof value.remainder !== "boolean") fail("Allocations need whole shares and an explicit remainder choice")
    return { id: id(value.id), shares, remainder: value.remainder }
  })
  unique(allocations.map(allocation => allocation.id))
  if (allocations.filter(allocation => allocation.remainder).length > 1) fail("Only one remainder allocation is supported")
  const rules = list(raw.rules, 30).map(input => {
    const value = object(input); exact(value, ["id", "clauseId", "condition", "action", "recurrence", "dependencies"])
    const clauseId = id(value.clauseId)
    const clause = clauses.get(clauseId)
    if (!clause || !markdown.includes(clause.sourceText)) fail("Rule is not linked to an authored clause")
    if (!["deterministic", "human"].includes(clause.coverage)) fail("Advisory or unsupported clauses cannot have executable actions")
    const condition = validatePredicate(value.condition)
    const conditionKinds = JSON.stringify(condition)
    if (conditionKinds.includes('"kind":"human"') && clause.coverage !== "human") fail("Qualitative judgment needs explicit human coverage")
    if (/"kind":"(live-price|bookmap)"|"field":"chart.lastClose"/.test(conditionKinds)) issues.push(`${clauseId}: current source unavailable; action cannot become eligible`)
    const actionRaw = object(value.action); exact(actionRaw, ["kind", "quantity", "orderType"], ["limitLevel", "stopLevel", "orderId"])
    if (!["close", "replace-protection"].includes(String(actionRaw.kind))) fail("Only exits or protection changes are supported")
    if (!["market", "limit", "stop", "stop-limit"].includes(String(actionRaw.orderType))) fail("Unsupported order type")
    const quantityRaw = object(actionRaw.quantity); exact(quantityRaw, ["basis"], ["value", "rounding", "allocationId"])
    const basis = quantityRaw.basis
    if (!["shares", "initial", "remaining", "all"].includes(String(basis))) fail("Quantity basis must be explicit; ambiguous some is unsupported")
    if (basis === "all") { if (quantityRaw.value !== undefined || quantityRaw.rounding !== undefined) fail("All shares cannot include a fraction") }
    else {
      const amount = positive(quantityRaw.value)
      if (basis === "shares" ? !Number.isSafeInteger(amount) : amount > 1 || quantityRaw.rounding !== "floor") fail("Quantity needs whole shares or an explicit fraction and floor rounding")
    }
    if (quantityRaw.allocationId !== undefined && !allocations.some(allocation => allocation.id === quantityRaw.allocationId)) fail("Unknown allocation")
    for (const key of ["limitLevel", "stopLevel"] as const) if (actionRaw[key] !== undefined && !levels.some(level => level.id === actionRaw[key])) fail("Undefined price level")
    const type = actionRaw.orderType
    if (["limit", "stop-limit"].includes(String(type)) !== (actionRaw.limitLevel !== undefined) || ["stop", "stop-limit"].includes(String(type)) !== (actionRaw.stopLevel !== undefined)) fail("Order prices must be explicitly bound for the selected type")
    if (actionRaw.kind === "replace-protection" && (typeof actionRaw.orderId !== "string" || !actionRaw.orderId.trim() || actionRaw.orderId.length > 200)) fail("Protection replacement requires an exact existing order")
    if (actionRaw.kind === "close" && actionRaw.orderId !== undefined) fail("Close does not replace an order")
    if (!["once", "on-rearm"].includes(String(value.recurrence))) fail("Recurrence must be explicit")
    const dependencies = list(value.dependencies, 10).map(input => { const dep = object(input); exact(dep, ["ruleId", "state"]); if (dep.state !== "filled") fail("Follow-up dependencies require actual fills"); return { ruleId: id(dep.ruleId), state: "filled" as const } })
    return { id: id(value.id), clauseId, condition, action: structuredClone(actionRaw) as unknown as ManagementAction, recurrence: value.recurrence as ManagementRule["recurrence"], dependencies }
  })
  unique(rules.map(rule => rule.id))
  const byId = new Map(rules.map(rule => [rule.id, rule]))
  const visit = (rule: ManagementRule, path: Set<string>) => {
    if (path.has(rule.id)) fail("Cyclic management dependencies")
    for (const dependency of rule.dependencies) { const target = byId.get(dependency.ruleId); if (!target) fail("Unknown management dependency"); visit(target, new Set([...path, rule.id])) }
  }
  rules.forEach(rule => visit(rule, new Set()))
  const semantics = rules.map(rule => ruleSemanticKey(rule, interpretation))
  unique(semantics)
  for (const clause of interpretation.clauses) {
    if (!markdown.includes(clause.sourceText)) fail("Clause does not preserve original wording")
    if (clause.mandatory && ["advisory", "unsupported"].includes(clause.coverage)) issues.push(`${clause.clauseId}: mandatory clause unresolved`)
    if (["deterministic", "human"].includes(clause.coverage) && !rules.some(rule => rule.clauseId === clause.clauseId)) issues.push(`${clause.clauseId}: no supported action interpretation`)
  }
  return { policy: { version: 1, levels, allocations, rules }, issues, monitorable: rules.length > 0 && !interpretation.clauses.some(clause => clause.mandatory && ["advisory", "unsupported"].includes(clause.coverage)) }
}

/** Rule names cannot reset completed actions. Clause/action identity is stable across renames. */
export function ruleSemanticKey(rule: ManagementRule, interpretation: TradebookInterpretation): string {
  const source = interpretation.clauses.find(clause => clause.clauseId === rule.clauseId)?.sourceText ?? ""
  return createHash("sha256").update(JSON.stringify({ source: source.trim().toLowerCase().replace(/\s+/g, " "), action: rule.action })).digest("hex")
}
export function resolveRuleQuantity(quantity: QuantityPolicy, initial: number, remaining: number, allocation?: number): number {
  const base = quantity.allocationId ? allocation : quantity.basis === "initial" ? initial : remaining
  if (base === undefined || !Number.isSafeInteger(base) || base <= 0 || !Number.isSafeInteger(remaining) || remaining <= 0) fail("Whole-share quantity basis is unavailable")
  const result = quantity.basis === "all" ? base : quantity.basis === "shares" ? quantity.value! : Math.floor(base * quantity.value!)
  if (!Number.isSafeInteger(result) || result <= 0 || result > remaining || (allocation !== undefined && result > allocation)) fail("Rule quantity is zero, excessive, or invalid")
  return result
}
