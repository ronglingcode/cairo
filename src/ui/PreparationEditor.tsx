import { useEffect, useRef, useState } from "react"
import type { PreparationNotes } from "../shared/contracts.mts"

interface Props {
  apiBaseUrl: string | null
  commandToken: string | null | undefined
  preparation: PreparationNotes | null
  loadError: string | null
  loaded: boolean
}

export function PreparationEditor({ apiBaseUrl, commandToken, preparation, loadError, loaded }: Props) {
  const [markdown, setMarkdown] = useState("")
  const [date, setDate] = useState("")
  const [symbol, setSymbol] = useState("")
  const [baseRevision, setBaseRevision] = useState<string | null | undefined>(undefined)
  const [savedContent, setSavedContent] = useState({ markdown: "", date: "", symbol: "" })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const edited = useRef(false)
  const canSave = !!apiBaseUrl && !!commandToken && loaded && !loadError && baseRevision !== undefined
  const dirty = markdown !== savedContent.markdown || date !== savedContent.date || symbol !== savedContent.symbol
  const externallyChanged = loaded && baseRevision !== undefined && (preparation?.revision ?? null) !== baseRevision

  function adopt(value: PreparationNotes | null) {
    const content = { markdown: value?.markdown ?? "", date: value?.date ?? "", symbol: value?.symbol ?? "" }
    setMarkdown(content.markdown)
    setDate(content.date)
    setSymbol(content.symbol)
    setSavedContent(content)
    setBaseRevision(value?.revision ?? null)
    edited.current = false
  }

  useEffect(() => {
    if (!loaded || baseRevision !== undefined || loadError) return
    if (!edited.current) adopt(preparation)
    else {
      setBaseRevision(null)
    }
  }, [loaded, preparation, loadError, baseRevision])

  useEffect(() => () => controller.current?.abort(), [])

  async function save() {
    if (!canSave || busy) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`${apiBaseUrl}/preparation`, {
        method: "POST", signal: abort.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${commandToken}` },
        body: JSON.stringify({ content: { markdown, date: date || null, symbol: symbol || null }, expectedRevision: baseRevision }),
      })
      const result = await response.json() as { preparation?: PreparationNotes; error?: string }
      if (!response.ok || !result.preparation) throw new Error(result.error ?? "Notes could not be saved")
      adopt(result.preparation)
      setMessage("Notes saved. Cairo chat will use this preparation when the copilot is connected.")
    } catch (caught) {
      if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : "Notes could not be saved")
    } finally { if (!abort.signal.aborted) setBusy(false) }
  }

  async function reload() {
    if (!apiBaseUrl || busy) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`${apiBaseUrl}/preparation`, { signal: abort.signal })
      const result = await response.json() as { preparation: PreparationNotes | null; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Saved notes could not be read")
      adopt(result.preparation)
      setMessage("Saved notes loaded.")
    } catch (caught) {
      if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : "Saved notes could not be read")
    } finally { if (!abort.signal.aborted) setBusy(false) }
  }

  return <section className="preparation-card">
    <div className="card-heading"><div><span className="eyebrow">PREMARKET PREPARATION</span><h2>Your notes</h2></div><span className="notes-state">{dirty ? "Unsaved edits" : preparation ? "Saved" : "New notes"}</span></div>
    <p className="notes-intro">Write your thesis, levels, scenarios, and how you want to manage a trade. Keep it in your own words.</p>
    <div className="notes-context">
      <label>Date <span>(optional)</span><input type="date" aria-label="Preparation date" value={date} disabled={busy} onChange={event => { edited.current = true; setDate(event.target.value) }} /></label>
      <label>Focus symbol <span>(optional)</span><input aria-label="Preparation symbol" value={symbol} maxLength={16} disabled={busy} placeholder="e.g. SPY" onChange={event => { edited.current = true; setSymbol(event.target.value.toUpperCase().trim()) }} /></label>
    </div>
    <label className="notes-label" htmlFor="preparation-notes">Preparation notes</label>
    <textarea id="preparation-notes" value={markdown} maxLength={65_536} disabled={busy} placeholder="What matters today? What would change your thesis? How do you want to manage the position?" onChange={event => { edited.current = true; setMarkdown(event.target.value); setMessage(null) }} />
    <div className="notes-actions"><button className="quiet-button" disabled={!canSave || busy || !dirty} onClick={() => void save()}>{busy ? "Working…" : "Save notes"}</button><button className="quiet-button" disabled={!apiBaseUrl || busy} onClick={() => void reload()}>{dirty ? "Discard edits and reload" : "Reload saved notes"}</button></div>
    {externallyChanged && <p className="chart-error" role="status">Saved notes changed since this draft was opened. Your draft is preserved; reload to use the saved version.</p>}
    {(error || loadError) && <p className="chart-error" role="alert">{error ?? loadError}</p>}
    {message && <p className="notes-message" role="status">{message}</p>}
    <p className="chart-footnote">Saved preparation is context for discussion. Position guidance is reviewed and attached separately.</p>
  </section>
}
