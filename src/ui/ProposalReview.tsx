import { useState } from "react"
import type { CairoSnapshot } from "../shared/contracts.mts"
export function ProposalReview({ snapshot }: { snapshot: CairoSnapshot }) {
  const [positionId, setPositionId] = useState(""); const [initial, setInitial] = useState("")
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  async function review(kind: string, id: string, accept: boolean, attach = false) {
    setBusy(true); setError(null)
    const position = snapshot.positions.find(item => item.positionId === positionId)
    const attachment = snapshot.attachments.find(item => item.positionId === positionId && item.accountId === snapshot.brokerFacts?.accountId && item.state !== "closed")
    try {
      if (attach && (!position || !Number.isSafeInteger(Number(initial)) || Number(initial) < position.quantity)) throw new Error("Select a current position and confirm its actual initial filled quantity")
      const response = await fetch(`${window.cairo?.apiBaseUrl}/proposals/${accept ? "accept" : "reject"}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.cairo?.commandToken}` }, body: JSON.stringify({ kind, id, reviewed,
        ...(attach && position ? { position: { accountId: snapshot.brokerFacts!.accountId, positionId, factsRevision: snapshot.brokerFactsRevision, initialQuantity: Number(initial), reviewed, carryInConfirmed: reviewed,
          ...(attachment ? { attachmentId: attachment.id, expectedAttachmentRevision: attachment.revision } : {}) } } : {}) }) })
      const result = await response.json(); if (!response.ok) throw new Error(result.error)
      setReviewed(false)
    } catch (error) { setError(error instanceof Error ? error.message : "Review failed") } finally { setBusy(false) }
  }
  if (!snapshot.noteProposals.length && !snapshot.guidanceProposals.length) return null
  return <section className="setup-card"><h2>Review AI proposals</h2>
    <p>Saving a guideline keeps an artifact. Attaching it explicitly replaces this position’s frozen guidance. Completed close/protection actions stay completed, including renamed rules.</p>
    <label>Position <select value={positionId} onChange={event => { setPositionId(event.target.value); setReviewed(false) }}><option value="">Save artifact only</option>{snapshot.positions.map(position => <option key={position.positionId} value={position.positionId}>{position.symbol} · {position.side} · {position.quantity} shares</option>)}</select></label>
    <label>Actual initial filled shares <input type="number" min={1} step={1} value={initial} onChange={event => { setInitial(event.target.value); setReviewed(false) }} /></label>
    {snapshot.attachments.find(item => item.positionId === positionId)?.markdown && <details><summary>Current position guidance · compare with proposed clauses below</summary><pre className="narrative-text">{snapshot.attachments.find(item => item.positionId === positionId)!.markdown}</pre></details>}
    <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed the original wording, interpreted quantities, current position and allocation changes.</label>
    {error && <p role="alert" className="chart-error">{error}</p>}
    {snapshot.noteProposals.map(proposal => <article className="position-item" key={proposal.id}><strong>Proposed preparation revision</strong><pre className="narrative-text">{proposal.content.markdown}</pre><button className="quiet-button" disabled={busy || !reviewed} onClick={() => void review("notes", proposal.id, true)}>Accept notes</button><button className="quiet-button" disabled={busy} onClick={() => void review("notes", proposal.id, false)}>Reject</button></article>)}
    {snapshot.guidanceProposals.map(proposal => <article className="position-item" key={proposal.id}><strong>{proposal.book.title}</strong><p>{proposal.issues.length ? `${proposal.issues.length} interpretation limitations · inspect the clause readback below` : "Supported interpretation · inspect the clause readback below"}</p><button className="quiet-button" disabled={busy || !reviewed} onClick={() => void review("guidance", proposal.id, true)}>Accept artifact</button><button className="quiet-button" disabled={busy || !reviewed || !positionId} onClick={() => void review("guidance", proposal.id, true, true)}>Accept and attach to selected position</button><button className="quiet-button" disabled={busy} onClick={() => void review("guidance", proposal.id, false)}>Reject</button></article>)}
  </section>
}
