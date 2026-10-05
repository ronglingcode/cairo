import { useEffect, useRef, useState } from "react"
import type { CopilotChat } from "../shared/contracts.mts"

export function CopilotPanel({ apiBaseUrl, commandToken, chat }: { apiBaseUrl: string | null; commandToken?: string | null; chat: CopilotChat | null }) {
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const history = useRef<HTMLDivElement | null>(null)
  const followLatest = useRef(true)
  const draftEdited = useRef(false)
  function updateDraft(value: string) {
    draftEdited.current = true
    setDraft(value)
    void window.cairo?.chatDraft?.(value).catch(() => {})
  }
  useEffect(() => {
    let active = true
    const unsubscribe = window.cairo?.onChatDraft?.(value => { if (active) { draftEdited.current = true; setDraft(value) } })
    void window.cairo?.chatDraft?.().then(value => { if (active && !draftEdited.current) setDraft(value) }).catch(() => {})
    return () => { active = false; unsubscribe?.() }
  }, [])
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (followLatest.current && history.current) history.current.scrollTop = history.current.scrollHeight }, [chat?.messages])
  async function command(action: "send" | "cancel" | "connect") {
    if (!apiBaseUrl || !commandToken || pending) return
    const abort = new AbortController()
    controller.current = abort
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`${apiBaseUrl}/copilot/${action}`, { method: "POST", signal: abort.signal,
        headers: { Authorization: `Bearer ${commandToken}`, "Content-Type": "application/json" },
        body: action === "send" ? JSON.stringify({ text: draft, commandId: crypto.randomUUID() }) : undefined,
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Chat request failed")
      if (action === "send") { updateDraft(""); followLatest.current = true }
    } catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : "Chat connection failed") }
    finally { if (!abort.signal.aborted) setPending(false) }
  }
  return <>
    <div className="chat-controls">
      <span>{chat?.fake ? "Local fake model · demo responses" : chat?.model || "Model not configured"}</span>
      <button className="quiet-button" disabled={!apiBaseUrl || pending} onClick={() => void command("connect")}>Reconnect chat</button>
    </div>
    <div className="chat-history" ref={history} role="log" aria-label="Cairo conversation" onScroll={event => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64 }}>
      {!chat?.messages.length && <div className="chat-intro"><h3>Prepare with Cairo</h3><p>Save your notes and refresh a one-minute chart, then discuss your scenarios here.</p><p>Chart knowledge is a timestamped snapshot. Notes do not activate position guidance.</p></div>}
      {chat?.messages.map(message => <article className={`chat-message ${message.role}`} key={message.id}>
        <strong>{message.role === "user" ? "You" : "Cairo"}</strong><div className="chat-text">{message.text}</div>
        {message.tools.map((tool, index) => <div className="chat-tool" key={`${tool.name}-${index}`}>{tool.name} · {tool.state}</div>)}
      </article>)}
      {chat?.truncated && <p className="chat-notice">Showing the latest 40 messages with bounded text. Earlier conversation remains in OpenCode.</p>}
    </div>
    <div className="chat-feedback" role="status">
      {error || chat?.error ? <p className="chart-error">{error || chat?.error}</p> : null}
      <span>{chat?.busy ? "Cairo is responding…" : chat?.outcome === "interrupted" ? "Reply canceled" : chat?.connected ? "Ready" : "Chat disconnected"}</span>
    </div>
    <form className="composer-wrap" onSubmit={event => { event.preventDefault(); void command("send") }}>
      <label className="notes-label" htmlFor="cairo-message">Message Cairo</label>
      <textarea id="cairo-message" value={draft} maxLength={8000} onChange={event => updateDraft(event.target.value)} placeholder="Discuss your preparation or trade…" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (chat?.connected && !chat.busy && !pending && draft.trim()) void command("send") } }} />
      <div className="composer-tools"><span>{draft.length}/8000</span>
        {chat?.busy && <button type="button" className="chat-cancel" disabled={pending || !chat.connected} onClick={() => void command("cancel")}>Cancel reply</button>}
        <button type="submit" className="chat-send" disabled={!chat?.connected || chat.busy || pending || !draft.trim()}>Send</button>
      </div>
    </form>
  </>
}
