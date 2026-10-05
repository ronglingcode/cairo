import { useEffect, useRef, useState } from "react"
import type { CopilotChat } from "../shared/contracts.mts"
import { completeSkill, skillQuery, type SkillSummary } from "../shared/SkillCommands.mts"
import type { BookmapPatternPicker as Picker } from "../shared/BookmapPatterns.mts"
import { BookmapPatternPicker } from "./BookmapPatternPicker"

export function CopilotPanel({ apiBaseUrl, commandToken, chat, patternPicker, patternError }: { apiBaseUrl: string | null; commandToken?: string | null; chat: CopilotChat | null; patternPicker?: Picker | null; patternError?: string | null }) {
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [skillError, setSkillError] = useState<string | null>(null)
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [activeSkill, setActiveSkill] = useState(0)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const skillController = useRef<AbortController | null>(null)
  const controller = useRef<AbortController | null>(null)
  const history = useRef<HTMLDivElement | null>(null)
  const followLatest = useRef(true)
  const draftEdited = useRef(false)
  const query = skillQuery(draft, caret)
  const matches = query ? skills.filter(skill => skill.name.startsWith(query.query)) : []
  const menuOpen = focused && !dismissed && query !== null
  const selectedIndex = Math.min(activeSkill, Math.max(0, matches.length - 1))
  const canSend = Boolean(apiBaseUrl && !chat?.busy && !pending && !patternPicker && draft.trim() && (chat?.connected || /^\/bookmap-pattern(?:\s|$)/.test(draft.trim())))
  async function loadSkills() {
    if (!apiBaseUrl || !commandToken) return
    skillController.current?.abort()
    const abort = new AbortController()
    skillController.current = abort
    setSkillsLoading(true)
    try {
      const response = await fetch(`${apiBaseUrl}/copilot/skills`, { headers: { Authorization: `Bearer ${commandToken}` }, signal: abort.signal })
      const result = await response.json() as { skills?: SkillSummary[]; error?: string }
      if (!response.ok || !result.skills) throw new Error(result.error ?? "Skill library unavailable")
      setSkills(result.skills)
      setSkillError(null)
    } catch (error) { if (!abort.signal.aborted) { setSkills([]); setSkillError(error instanceof Error ? error.message : "Skill library unavailable") } }
    finally { if (!abort.signal.aborted) setSkillsLoading(false) }
  }
  useEffect(() => { void loadSkills(); return () => skillController.current?.abort() }, [apiBaseUrl, commandToken])
  function chooseSkill(skill: SkillSummary) {
    if (!query) return
    const completed = completeSkill(draft, query, skill.name)
    if (completed.text.length > 8000) { setError("Message with skill must fit within 8000 characters"); return }
    updateDraft(completed.text)
    setCaret(completed.caret)
    setDismissed(true)
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.setSelectionRange(completed.caret, completed.caret) })
  }
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
      const result = await response.json() as { error?: string; patternSelectionRequired?: boolean }
      if (!response.ok) throw new Error(result.error ?? "Chat request failed")
      if (action === "send" && !result.patternSelectionRequired) { updateDraft(""); followLatest.current = true }
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
      {patternError && <p className="chart-error">{patternError}</p>}
      {error || chat?.error ? <p className="chart-error">{error || chat?.error}</p> : null}
      <span>{chat?.busy ? "Cairo is responding…" : chat?.outcome === "interrupted" ? "Reply canceled" : chat?.connected ? "Ready" : "Chat disconnected"}</span>
    </div>
    {patternPicker && <BookmapPatternPicker key={patternPicker.id} picker={patternPicker} apiBaseUrl={apiBaseUrl} commandToken={commandToken} onComplete={() => { if (draft === patternPicker.text) updateDraft(""); followLatest.current = true }} />}
    <form className="composer-wrap" onSubmit={event => { event.preventDefault(); void command("send") }}>
      <label className="notes-label" htmlFor="cairo-message">Message Cairo</label>
      {menuOpen && <div className="skill-menu" id="cairo-skill-menu" role="listbox" aria-label="Cairo skills">
        <div className="skill-menu-hint">Skills · ↑↓ select · Enter or Tab insert</div>
        {matches.map((skill, index) => <button type="button" role="option" aria-selected={index === selectedIndex} id={`cairo-skill-${skill.name}`} className={index === selectedIndex ? "selected" : ""} key={skill.name}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActiveSkill(index)} onClick={() => chooseSkill(skill)}>
          <strong>/{skill.name}</strong><span>{skill.description}</span>
        </button>)}
        {!matches.length && <p role="status">{skillsLoading ? "Loading skills…" : skillError || "No matching skills"}</p>}
      </div>}
      <textarea ref={composer} id="cairo-message" value={draft} maxLength={8000} role="combobox" aria-autocomplete="list" aria-expanded={menuOpen} aria-controls="cairo-skill-menu"
        aria-activedescendant={menuOpen && matches[selectedIndex] ? `cairo-skill-${matches[selectedIndex].name}` : undefined}
        onFocus={event => { setFocused(true); setCaret(event.currentTarget.selectionStart); setDismissed(false); void loadSkills() }} onBlur={() => setFocused(false)}
        onSelect={event => setCaret(event.currentTarget.selectionStart)}
        onChange={event => { updateDraft(event.target.value); setCaret(event.target.selectionStart); setDismissed(false); setActiveSkill(0) }}
        placeholder="Ask Cairo or type / to choose a skill…" onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (menuOpen && event.key === "Escape") { event.preventDefault(); setDismissed(true); return }
          if (menuOpen && matches.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault(); setActiveSkill((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length); return
          }
          if (menuOpen && matches.length && !event.shiftKey && ["Enter", "Tab"].includes(event.key)) { event.preventDefault(); chooseSkill(matches[selectedIndex]); return }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canSend) void command("send") }
        }} />
      <div className="composer-tools"><span>{draft.length}/8000</span>
        {chat?.busy && <button type="button" className="chat-cancel" disabled={pending || !chat.connected} onClick={() => void command("cancel")}>Cancel reply</button>}
        <button type="submit" className="chat-send" disabled={!canSend}>Send</button>
      </div>
    </form>
  </>
}
