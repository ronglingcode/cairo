import { randomUUID } from "node:crypto"
import type { CairoEngine } from "./CairoEngine.mts"
import { evaluatePredicate, type HumanConfirmation, type PredicateResult } from "./PredicateEvaluator.mts"
import { resolveRuleQuantity, ruleSemanticKey, type ManagementAction } from "./ManagementPolicy.mts"
import { policyRevision, type PositionGuidance } from "./PositionGuidance.mts"
import type { PositionAttachment } from "../shared/contracts.mts"

export interface RuleReadback {
  attachmentId: string; ruleId: string; semanticKey: string; sourceText: string
  status: "waiting" | "recommended" | "awaiting-fill" | "filled" | "paused"
  result: PredicateResult; quantity: number | null
}
export interface ManagementRecommendation {
  id: string; attachmentId: string; attachmentRevision: string; ruleId: string; semanticKey: string
  accountId: string; positionId: string; symbol: string; quantity: number; action: ManagementAction
  sourceClauseId: string; reason: string; createdAt: string; factsRevision: number
  state: "current" | "invalidated" | "submitted" | "filled"
}
interface RuleState { status: RuleReadback["status"]; recommendationId?: string; brokerOrderId?: string }
export class ManagementMonitor {
  private readonly engine: CairoEngine
  private readonly guidance: PositionGuidance
  private readonly now: () => number
  private states = new Map<string, RuleState>()
  private confirmations: HumanConfirmation[] = []
  prepareReplacement(attachment: PositionAttachment, interpretation: PositionAttachment["interpretation"]): () => void {
    const prior = attachment.interpretation.management!.rules.map(rule => ({ rule, state: this.states.get(`${attachment.id}:${ruleSemanticKey(rule, attachment.interpretation)}`) }))
    if (prior.some(item => item.state?.brokerOrderId)) throw new Error("Resolve broker-pending actions before changing guidance")
    // Conservatively carry completed close/protection actions across wording, IDs and quantities.
    // An edited policy cannot reset a completed once-only action.
    const completed = prior.filter(item => item.state?.status === "filled")
    return () => {
      this.confirmations = this.confirmations.filter(item => item.scope.attachmentId !== attachment.id)
      for (const rule of interpretation.management!.rules) if (completed.some(item => item.rule.action.kind === rule.action.kind && item.rule.action.orderType === rule.action.orderType)) this.states.set(`${attachment.id}:${ruleSemanticKey(rule, interpretation)}`, { status: "filled" })
      this.engine.updateSnapshot({ recommendations: this.engine.getSnapshot().recommendations.map(item => item.attachmentId === attachment.id && item.state === "current" ? { ...item, state: "invalidated" } : item) })
    }
  }
  constructor(engine: CairoEngine, guidance: PositionGuidance, now: () => number = Date.now) { this.engine = engine; this.guidance = guidance; this.now = now }
  confirm(attachmentId: string, expectedRevision: string, factsRevision: number, conditionId: string, value: boolean): void {
    const snapshot = this.engine.getSnapshot()
    const attachment = snapshot.attachments.find(item => item.id === attachmentId && item.revision === expectedRevision && item.state === "active")
    if (!attachment || typeof value !== "boolean" || typeof conditionId !== "string") throw new Error("Active current guidance and an explicit confirmation are required")
    this.guidance.currentPosition(attachment.accountId, attachment.positionId, factsRevision)
    const visit = (condition: import("./PredicateEvaluator.mts").Predicate): boolean => condition.kind === "human" ? condition.conditionId === conditionId : condition.kind === "all" || condition.kind === "any" ? condition.conditions.some(visit) : false
    if (!attachment.interpretation.management?.rules.some(rule => visit(rule.condition))) throw new Error("Confirmation is not a human condition in this attached policy")
    this.confirmations = [...this.confirmations.filter(item => Date.parse(item.expiresAt) > this.now()), {
      scope: this.scope(attachment), runtimeInstanceId: snapshot.runtimeInstanceId, brokerFactsRevision: factsRevision, conditionId, value,
      confirmedAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + 5 * 60_000).toISOString(),
    }].slice(-100)
    this.cycle()
  }
  rearm(attachmentId: string, expectedRevision: string, ruleId: string): void {
    const attachment = this.engine.getSnapshot().attachments.find(item => item.id === attachmentId && item.revision === expectedRevision && item.state === "active")
    const rule = attachment?.interpretation.management?.rules.find(item => item.id === ruleId)
    if (!attachment || !rule) throw new Error("Current active rule is required")
    const key = `${attachment.id}:${ruleSemanticKey(rule, attachment.interpretation)}`
    const state = this.states.get(key)
    if (state?.brokerOrderId || state?.status === "filled" && rule.recurrence === "once") throw new Error("Completed or broker-pending action cannot be reset")
    this.states.delete(key)
    this.confirmations = this.confirmations.filter(item => item.scope.attachmentId !== attachmentId)
    this.engine.updateSnapshot({ recommendations: this.engine.getSnapshot().recommendations.map(item => item.attachmentId === attachmentId && item.semanticKey === ruleSemanticKey(rule, attachment.interpretation) ? { ...item, state: "invalidated" } : item) })
    this.cycle()
  }
  /** Called only by the future approved broker writer after a known broker order identity. */
  bindSubmittedOrder(recommendationId: string, brokerOrderId: string): void {
    const recommendation = this.engine.getSnapshot().recommendations.find(item => item.id === recommendationId && item.state === "current")
    if (!recommendation || !brokerOrderId) throw new Error("Current recommendation and known order identity required")
    this.states.set(`${recommendation.attachmentId}:${recommendation.semanticKey}`, { status: "awaiting-fill", recommendationId, brokerOrderId })
    this.engine.updateSnapshot({ recommendations: this.engine.getSnapshot().recommendations.map(item => item.id === recommendationId ? { ...item, state: "submitted" } : item) })
  }
  cycle(): void {
    const snapshot = this.engine.getSnapshot()
    const recommendations = structuredClone(snapshot.recommendations)
    const readbacks: RuleReadback[] = []
    for (const attachment of snapshot.attachments.slice(0, 100)) {
      const policy = attachment.interpretation.management
      if (!policy) continue
      for (const rule of policy.rules) {
        const semanticKey = ruleSemanticKey(rule, attachment.interpretation)
        const key = `${attachment.id}:${semanticKey}`
        const state = this.states.get(key) ?? { status: "waiting" as const }
        const sourceText = attachment.interpretation.clauses.find(clause => clause.clauseId === rule.clauseId)!.sourceText
        const matchingRecommendation = recommendations.find(item => item.id === state.recommendationId)
        if (state.status === "awaiting-fill" && state.brokerOrderId && matchingRecommendation && snapshot.broker.state === "connected" && snapshot.brokerFacts?.accountId === attachment.accountId) {
          const age = this.now() - Date.parse(snapshot.brokerFacts.asOf)
          const fills = new Map(snapshot.brokerFacts.recentFills.filter(fill => Number.isFinite(age) && age >= 0 && age <= 60_000 && fill.orderId === state.brokerOrderId && fill.symbol === attachment.symbol && fill.side === (attachment.baseline?.side === "short" ? "buy" : "sell") && Number.isFinite(fill.quantity) && fill.quantity > 0 && Date.parse(fill.filledAt) >= Date.parse(matchingRecommendation.createdAt) && Date.parse(fill.filledAt) <= this.now()).map(fill => [fill.fillId, fill]))
          const total = [...fills.values()].reduce((sum, fill) => sum + fill.quantity, 0)
          if (total >= matchingRecommendation.quantity) { state.status = "filled"; state.brokerOrderId = undefined; matchingRecommendation.state = "filled" }
        }
        let result = evaluatePredicate(rule.condition, { snapshot, scope: this.scope(attachment), now: this.now(), confirmations: this.confirmations })
        let quantity: number | null = null
        const dependenciesReady = rule.dependencies.every(dependency => {
          const target = policy.rules.find(value => value.id === dependency.ruleId)!
          return this.states.get(`${attachment.id}:${ruleSemanticKey(target, attachment.interpretation)}`)?.status === "filled"
        })
        if (!dependenciesReady) result = { state: "pending", actionEligible: false, evidence: [{ state: "pending", source: "broker", reason: "Waiting for actual fills of prerequisite actions", sourceAt: snapshot.brokerFacts?.asOf ?? null }] }
        if (attachment.state !== "active") {
          result.actionEligible = false
          result = { state: "unknown", actionEligible: false, evidence: [{ state: "unknown", source: "unavailable", reason: attachment.pauseReason ?? "Position guidance is not active", sourceAt: null }] }
        }
        if (result.actionEligible && attachment.state === "active") {
          try {
            const position = this.guidance.currentPosition(attachment.accountId, attachment.positionId, snapshot.brokerFactsRevision)
            const allocation = rule.action.quantity.allocationId ? policy.allocations.find(value => value.id === rule.action.quantity.allocationId)?.shares : undefined
            quantity = resolveRuleQuantity(rule.action.quantity, attachment.initialQuantity!, position.quantity, allocation)
          } catch (error) { result = { state: "invalid", actionEligible: false, evidence: [{ state: "invalid", source: "broker", reason: error instanceof Error ? error.message : "Quantity unavailable", sourceAt: snapshot.brokerFacts?.asOf ?? null }] } }
        }
        if (state.status === "waiting" && result.actionEligible && quantity) {
          const recommendation: ManagementRecommendation = { id: randomUUID(), attachmentId: attachment.id, attachmentRevision: attachment.revision!, ruleId: rule.id, semanticKey,
            accountId: attachment.accountId, positionId: attachment.positionId, symbol: attachment.symbol, quantity, action: structuredClone(rule.action), sourceClauseId: rule.clauseId,
            reason: sourceText, createdAt: new Date(this.now()).toISOString(), factsRevision: snapshot.brokerFactsRevision, state: "current" }
          recommendations.push(recommendation); state.status = "recommended"; state.recommendationId = recommendation.id
        }
        if (state.status === "recommended" && matchingRecommendation && (!result.actionEligible || matchingRecommendation.attachmentRevision !== attachment.revision)) matchingRecommendation.state = "invalidated"
        this.states.set(key, state)
        readbacks.push({ attachmentId: attachment.id, ruleId: rule.id, semanticKey, sourceText, status: attachment.state === "active" ? state.status : "paused", result, quantity })
      }
    }
    const bounded = recommendations.slice(-100)
    if (JSON.stringify(snapshot.management) !== JSON.stringify(readbacks) || JSON.stringify(snapshot.recommendations) !== JSON.stringify(bounded)) this.engine.updateSnapshot({ management: readbacks, recommendations: bounded })
    const live = new Set(snapshot.attachments.map(attachment => attachment.id))
    for (const key of this.states.keys()) if (!live.has(key.split(":")[0]!)) this.states.delete(key)
  }
  private scope(attachment: PositionAttachment) { return { accountId: attachment.accountId, positionId: attachment.positionId, symbol: attachment.symbol, attachmentId: attachment.id, interpretationRevision: policyRevision(attachment) } }
}
