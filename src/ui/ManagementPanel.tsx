import { useState } from "react"
import type { CairoSnapshot } from "../shared/contracts.mts"
import type { Predicate } from "../engine/PredicateEvaluator.mts"
function humans(predicate: Predicate): string[] { return predicate.kind === "human" ? [predicate.conditionId] : predicate.kind === "all" || predicate.kind === "any" ? predicate.conditions.flatMap(humans) : [] }
function describe(predicate: Predicate): string {
  if (predicate.kind === "human") return `your confirmation of ${predicate.conditionId}`
  if (predicate.kind === "compare") return `${predicate.field.replace("broker.markPrice", "broker mark").replace("position.quantity", "remaining shares").replace("position.averagePrice", "average entry price").replace("chart.lastClose", "snapshot close")} ${{ gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" }[predicate.operator]} ${predicate.value}`
  if (predicate.kind === "all" || predicate.kind === "any") return predicate.conditions.map(describe).join(predicate.kind === "all" ? " and " : " or ")
  if (predicate.kind === "broker-fill") return `actual ${predicate.side} fills of ${predicate.minimumQuantity} shares for order ${predicate.orderId}`
  if (predicate.kind === "scalar") return "a constant comparison"
  return "conditionId" in predicate ? `${predicate.kind} observation ${predicate.conditionId} (source unavailable)` : "unavailable observation"
}
export function ManagementPanel({ snapshot }: { snapshot: CairoSnapshot }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function command(path: string, value: unknown) {
    setBusy(true); setError(null)
    try {
      const response = await fetch(`${window.cairo?.apiBaseUrl}/management/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.cairo?.commandToken}` }, body: JSON.stringify(value) })
      const result = await response.json(); if (!response.ok) throw new Error(result.error)
    } catch (error) { setError(error instanceof Error ? error.message : "Management unavailable") }
    finally { setBusy(false) }
  }
  return <section className="setup-card"><div className="card-heading"><div><span className="eyebrow">ATTACHED GUIDANCE</span><h2>Management monitor</h2></div></div>
    <p>Every attached position is monitored by the engine. Chart focus and AI availability do not stop monitoring.</p>
    {error && <p role="alert" className="chart-error">{error}</p>}
    {snapshot.guidanceProposals.map(proposal => <article className="position-item" key={proposal.id}><strong>Proposed interpretation · {proposal.book.title}</strong>
      <p>Review only · expires {new Date(proposal.expiresAt).toLocaleTimeString()}</p>
      {proposal.book.interpretation?.clauses.map(clause => <div className="clause-readback" key={clause.clauseId}><blockquote>{clause.sourceText}</blockquote><strong>{clause.coverage}</strong><p>{clause.explanation}</p></div>)}
      {proposal.book.interpretation?.management?.levels.map(level => <p key={level.id}>Fixed level {level.id}: ${level.value.toFixed(2)} · {level.sourceText}</p>)}
      {proposal.book.interpretation?.management?.rules.map(rule => <p key={rule.id}>When {describe(rule.condition)}: {rule.action.kind} · {rule.action.quantity.basis === "all" ? "all remaining shares" : rule.action.quantity.basis === "shares" ? `${rule.action.quantity.value} shares` : `${(rule.action.quantity.value ?? 0) * 100}% of ${rule.action.quantity.basis} shares, rounded down`} · {rule.action.orderType} · {rule.recurrence}{rule.dependencies.length ? " · requires actual fills of prerequisite actions" : ""}</p>)}
      {proposal.issues.map((issue, index) => <p key={index} role="status">Needs attention: {issue}</p>)}
    </article>)}
    {!snapshot.attachments.length && <div className="empty-inline">Review a guideline interpretation before attaching it to a position.</div>}
    {snapshot.attachments.map(attachment => <article className="position-item" key={attachment.id}><strong>{attachment.symbol} · {attachment.state}</strong><p>{attachment.pauseReason}</p>
      <details><summary>Frozen original guidance</summary><pre className="narrative-text">{attachment.markdown}</pre></details>
      {snapshot.management.filter(rule => rule.attachmentId === attachment.id).map(rule => {
        const policyRule = attachment.interpretation.management?.rules.find(item => item.id === rule.ruleId)
        return <div className="clause-readback" key={rule.ruleId}><blockquote>{rule.sourceText}</blockquote><strong>{rule.status} · condition {rule.result.state}{rule.quantity ? ` · ${rule.quantity} shares` : ""}</strong>
          {rule.result.evidence.map((evidence, index) => <p key={index}>{evidence.reason}{evidence.sourceAt ? ` · ${new Date(evidence.sourceAt).toLocaleTimeString()}` : ""}</p>)}
          {policyRule && humans(policyRule.condition).map(conditionId => <button className="quiet-button" key={conditionId} disabled={busy || attachment.state !== "active"} onClick={() => void command("confirm", { id: attachment.id, expectedRevision: attachment.revision, factsRevision: snapshot.brokerFactsRevision, conditionId, value: true })}>Confirm observation: {conditionId}</button>)}
          <button className="quiet-button" disabled={busy || attachment.state !== "active" || rule.status === "filled" || rule.status === "awaiting-fill"} onClick={() => void command("rearm", { id: attachment.id, expectedRevision: attachment.revision, ruleId: rule.ruleId })}>Review and rearm</button>
        </div>
      })}
      {attachment.state === "active" && <button className="quiet-button" disabled={busy} onClick={() => void command("pause", { id: attachment.id, expectedRevision: attachment.revision })}>Pause guidance</button>}
      {attachment.state === "paused" && <button className="quiet-button" disabled={busy} onClick={() => void command("reconfirm", { id: attachment.id, expectedRevision: attachment.revision, factsRevision: snapshot.brokerFactsRevision, initialQuantity: attachment.initialQuantity, reviewed: true })}>I reviewed current quantity and allocations · resume</button>}
    </article>)}
    <p className="chart-footnote">Observation confirmation supplies evidence. Exit recommendations require a separate exact ticket approval.</p>
    <details><summary>Session timeline ({snapshot.managementTimeline.length})</summary>{snapshot.managementTimeline.slice(-20).reverse().map(event => <p key={event.id}>{new Date(event.at).toLocaleTimeString()} · {event.symbol} · {event.text}</p>)}</details>
  </section>
}
