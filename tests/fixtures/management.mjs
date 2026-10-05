import { createHash } from "node:crypto"
export function policyBook(style = "partial") {
  const sourceText = style === "partial" ? "When I confirm the target, exit 50% of initial shares with floor rounding." : "When I confirm weakness, exit all shares. Do not move my stop."
  const markdown = `# ${style}\n${sourceText}\n`
  const hash = createHash("sha256").update(markdown).digest("hex")
  const management = { version: 1, levels: [], allocations: [], rules: [{ id: "exit", clauseId: "clause", condition: { kind: "human", conditionId: "trigger" }, action: { kind: "close", quantity: style === "partial" ? { basis: "initial", value: .5, rounding: "floor" } : { basis: "all" }, orderType: "market" }, recurrence: "once", dependencies: [] }] }
  return { id: style, title: style, markdown, contentHash: hash, revision: hash, interpretation: { tradebookId: style, narrativeHash: hash, clauses: [{ clauseId: "clause", sourceText, coverage: "human", explanation: "Only a scoped trader confirmation establishes this condition." }], management } }
}
