import { BookmapSetupCards } from "./BookmapSetupCards"
import type { CairoSnapshot } from "../shared/contracts.mts"
import { useState } from "react"
export function BookmapPanel({ snapshot }: { snapshot: CairoSnapshot | null }) {
  const [symbol, setSymbol] = useState("AAPL"), [pattern, setPattern] = useState("BID_REAPPEAR"), [bookId, setBookId] = useState("personal-gap-give-go"), [confirmations, setConfirmations] = useState<string[]>([]), [error, setError] = useState<string | null>(null)
  const book = snapshot?.tradebooks.find(item => item.id === bookId)
  async function command(route: string, body: unknown) {
    try { const response = await fetch(`${window.cairo?.apiBaseUrl}/observation/${route}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.cairo?.commandToken}` }, body: JSON.stringify(body) }); const result = await response.json(); setError(response.ok ? null : result.error) } catch { setError("Observation command unavailable") }
  }
  const projection = snapshot?.bookmapProjection
  return <section className="panel"><BookmapSetupCards snapshot={snapshot} /><h3>Bookmap observations</h3><p>{snapshot?.bookmap.detail ?? "Waiting for companion"}</p>
    {Object.entries(projection?.symbols ?? {}).map(([symbol, status]) => <p key={symbol}>{symbol} · {status.mode} · {status.readiness} · heartbeat {status.heartbeatAt}</p>)}
    {projection?.episodes.slice(-5).reverse().map(({ observation, freshEvent }) => <p key={`${observation.symbol.canonical}:${observation.episodeId}`}>{observation.symbol.canonical} · {observation.pattern} · ${observation.price} · revision {observation.revision} · {freshEvent ? "event evidence" : "context only"}</p>)}
    <details><summary>Review an observer attempt</summary><p>Entry recommendations last five minutes. Enter through your existing platform. Review all discretionary setup conditions before activating.</p>
      <label>Symbol <input value={symbol} onChange={event => { setSymbol(event.target.value.toUpperCase()); setConfirmations([]) }} /></label>
      <label>Pattern <select value={pattern} onChange={event => { setPattern(event.target.value); setConfirmations([]) }}><option>BID_REAPPEAR</option><option>BID_STEP_UP</option></select></label>
      <label>Narrative <select value={bookId} onChange={event => { setBookId(event.target.value); setConfirmations([]) }}>{snapshot?.tradebooks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <pre className="narrative">{book?.markdown}</pre>
      {book?.interpretation?.clauses.filter(clause => clause.mandatory && clause.coverage !== "deterministic").map(clause => <label key={clause.clauseId}><input type="checkbox" checked={confirmations.includes(clause.clauseId)} onChange={event => setConfirmations(event.target.checked ? [...confirmations, clause.clauseId] : confirmations.filter(id => id !== clause.clauseId))} />I confirm for this attempt: {clause.sourceText}</label>)}
      <button disabled={!book || !snapshot} onClick={() => void command("activate", { symbol, pattern, tradebookId: bookId, expectedRevision: book?.revision, reviewed: true, confirmedClauses: confirmations })}>Activate / rearm observer</button>
    </details>
    {snapshot?.observationAttempts.slice(-3).reverse().map(attempt => <div key={attempt.id}><p>{attempt.symbol} · {attempt.pattern} · {attempt.state} · {attempt.detail}</p>{attempt.signal && <p>Episode {attempt.signal.evidence.episodeId} · ${attempt.signal.evidence.price} · revision {attempt.signal.evidence.revision}</p>}{["active", "alerted"].includes(attempt.state) && <button onClick={() => void command("deactivate", { id: attempt.id })}>Deactivate</button>}</div>)}
    {error && <p role="alert">{error}</p>}
  </section>
}
