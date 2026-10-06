import { useState } from "react"
import type { BookmapPatternPicker as Picker } from "../shared/BookmapPatterns.mts"

export function BookmapPatternPicker({ picker, apiBaseUrl, commandToken, onComplete }: { picker: Picker; apiBaseUrl: string | null; commandToken?: string | null; onComplete: () => void }) {
  const [positionId, setPositionId] = useState(picker.positions.length === 1 ? picker.positions[0].position.positionId : "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const choice = picker.positions.find(item => item.position.positionId === positionId)
  async function command(action: "select" | "cancel", patternId?: string) {
    if (!apiBaseUrl || !commandToken || pending) return
    setPending(true); setError(null)
    try {
      const response = await fetch(`${apiBaseUrl}/bookmap-pattern/${action}`, { method: "POST", headers: { Authorization: `Bearer ${commandToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ pickerId: picker.id, positionId, patternId }) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Pattern could not be saved")
      if (action === "select") onComplete()
    } catch (error) { setError(error instanceof Error ? error.message : "Pattern could not be saved") }
    finally { setPending(false) }
  }
  return <section className="bookmap-pattern-picker" aria-label="Tag Bookmap pattern">
    <div className="pattern-heading"><strong>{picker.manual ? "Tag current trade" : "Choose the trade’s Bookmap pattern"}</strong><button type="button" className="quiet-button" disabled={pending} onClick={() => void command("cancel")}>Cancel</button></div>
    {picker.positions.length > 1 && <label>Trade <select aria-label="Trade to tag" value={positionId} disabled={pending} onChange={event => setPositionId(event.target.value)}><option value="">Choose a trade…</option>{picker.positions.map(({ position }) => <option key={position.positionId} value={position.positionId}>{position.symbol} · {position.side} · {position.quantity} shares</option>)}</select></label>}
    {choice && <>
      <p>{choice.position.symbol} · {choice.position.side} · {choice.position.quantity} shares</p>
      {choice.tag && <p className="pattern-previous">{choice.tag.active ? "Saved" : "Previous trade"} pattern: {choice.candidates.find(pattern => pattern.id === choice.tag?.patternId)?.name ?? choice.tag.patternId}. Click to confirm or change.</p>}
      <div className="pattern-options">{choice.candidates.map(pattern => <button type="button" key={pattern.id} disabled={pending || !apiBaseUrl || !commandToken} onClick={() => void command("select", pattern.id)}><strong>{pattern.name}</strong>{choice.tag?.patternId === pattern.id && <span>Previously tagged</span>}</button>)}</div>
      {!choice.candidates.length && <p>No active patterns for this side.</p>}
      <small>{picker.origin === "partial-management" ? "Confirm a pattern to automatically review this trade’s stop loss and targets." : picker.manual ? "Click a pattern to save it for this trade." : "Click to save the pattern and continue your request."}</small>
    </>}
    {pending && <p role="status">Saving…</p>}
    {error && <p className="chart-error" role="alert">{error}</p>}
  </section>
}
