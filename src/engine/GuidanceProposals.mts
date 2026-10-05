import { createHash, randomUUID } from "node:crypto"
import type { CairoEngine } from "./CairoEngine.mts"
import type { Tradebook, TradebookInterpretation } from "../shared/contracts.mts"
import { validateManagementPolicy } from "./ManagementPolicy.mts"
export interface GuidanceProposal {
  id: string; sessionId: string; expectedPreparationRevision: string; expectedTradebookRevision: string | null
  book: Tradebook; issues: string[]; expiresAt: string
}
export class GuidanceProposals {
  private engine: CairoEngine
  private now: () => number
  constructor(engine: CairoEngine, now: () => number = Date.now) { this.engine = engine; this.now = now }
  propose(input: Record<string, unknown>, sessionId: string): GuidanceProposal {
    if (Object.keys(input).some(key => !["tradebookId", "expectedPreparationRevision", "expectedTradebookRevision", "clauses", "management"].includes(key))) throw new Error("Unsupported guidance proposal fields")
    const snapshot = this.engine.getSnapshot(); const preparation = snapshot.preparation
    if (!preparation || snapshot.preparationError || input.expectedPreparationRevision !== preparation.revision) throw new Error("Read the latest saved narrative before interpreting it")
    if (typeof input.tradebookId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input.tradebookId)) throw new Error("Invalid tradebook identity")
    const existing = snapshot.tradebooks.find(book => book.id === input.tradebookId)
    if (input.expectedTradebookRevision !== (existing?.revision ?? null)) throw new Error("Tradebook revision changed")
    if (!Array.isArray(input.clauses) || input.clauses.length > 60 || !input.clauses.length) throw new Error("Complete clause interpretations are required")
    const markdown = preparation.markdown
    const interpretation: TradebookInterpretation = { tradebookId: input.tradebookId, narrativeHash: hash(markdown), clauses: structuredClone(input.clauses) }
    const seen = new Set<string>()
    for (const clause of interpretation.clauses) {
      if (!clause || Object.keys(clause).some(key => !["clauseId", "sourceText", "coverage", "explanation", "mandatory"].includes(key)) || typeof clause.clauseId !== "string" || seen.has(clause.clauseId) || typeof clause.sourceText !== "string" || !clause.sourceText.trim() || !markdown.includes(clause.sourceText) || !["human", "deterministic", "advisory", "unsupported"].includes(clause.coverage) || typeof clause.explanation !== "string" || clause.explanation.length > 2000 || clause.mandatory !== undefined && typeof clause.mandatory !== "boolean") throw new Error("Each clause needs exact authored text and supported coverage")
      seen.add(clause.clauseId)
    }
    const checked = validateManagementPolicy(input.management, interpretation, markdown)
    interpretation.management = checked.policy
    for (const level of checked.policy.levels) numericSource(level.value, level.sourceText)
    for (const allocation of checked.policy.allocations) numericSource(allocation.shares, markdown)
    for (const rule of checked.policy.rules) {
      const source = interpretation.clauses.find(clause => clause.clauseId === rule.clauseId)!.sourceText
      if (rule.action.quantity.value !== undefined) numericSource(rule.action.quantity.value, source)
      if (rule.action.quantity.basis === "all" && !/\b(all|entire|full)\b/i.test(source)) throw new Error("Clarify the exit quantity; all shares was not authored")
      if (rule.action.quantity.basis === "initial" && !/\binitial\b/i.test(source) || rule.action.quantity.basis === "remaining" && !/\bremaining\b/i.test(source)) throw new Error("Clarify initial versus remaining shares")
      if (rule.action.quantity.rounding === "floor" && !/\b(floor|round down)\b/i.test(source)) throw new Error("Ask how fractional shares should be rounded")
      const visit = (condition: import("./PredicateEvaluator.mts").Predicate): void => {
        if (condition.kind === "scalar") throw new Error("Constant conditions cannot replace an authored market observation")
        if (condition.kind === "compare") numericSource(condition.value, source)
        if (condition.kind === "broker-fill") numericSource(condition.minimumQuantity, source)
        if (condition.kind === "all" || condition.kind === "any") condition.conditions.forEach(visit)
      }; visit(rule.condition)
    }
    const issues = [...checked.issues, ...interpretation.clauses.filter(clause => ["advisory", "unsupported"].includes(clause.coverage)).map(clause => `${clause.clauseId}: ${clause.explanation}`)]
    const proposal: GuidanceProposal = { id: randomUUID(), sessionId, expectedPreparationRevision: preparation.revision, expectedTradebookRevision: input.expectedTradebookRevision as string | null,
      book: { id: input.tradebookId, title: markdown.split(/\r?\n/).find(line => line.startsWith("# "))?.slice(2) ?? "Management guidelines", markdown, contentHash: hash(markdown), revision: hash(JSON.stringify(interpretation)), interpretation }, issues, expiresAt: new Date(this.now() + 5 * 60_000).toISOString() }
    this.engine.updateSnapshot({ guidanceProposals: [...snapshot.guidanceProposals.filter(item => Date.parse(item.expiresAt) > this.now()), proposal].slice(-20) })
    return structuredClone(proposal)
  }
}
function hash(text: string): string { return createHash("sha256").update(text).digest("hex") }
function numericSource(value: number, text: string): void {
  const numbers = [...text.matchAll(/(?:\d+(?:\.\d+)?|\.\d+)\s*%?/g)].map(match => match[0].trim().endsWith("%") ? Number.parseFloat(match[0]) / 100 : Number.parseFloat(match[0]))
  if (!numbers.includes(value)) throw new Error(`Clarify ${value}: this number was not present in the authored clause`)
}
