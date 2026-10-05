import { useEffect, useMemo, useRef, useState } from "react"
import type { CairoSnapshot, SourceStatus } from "../shared/contracts.mts"
import { EngineConnection, type RendererConnectionState } from "../renderer/EngineConnection.mts"
import { ChartView } from "./ChartView"

const EMPTY_STATUS: SourceStatus = { source: "chart", state: "unknown", updatedAt: null, detail: "Engine snapshot unavailable" }

export function App() {
  const apiBaseUrl = window.cairo?.apiBaseUrl ?? null
  const [snapshot, setSnapshot] = useState<CairoSnapshot | null>(null)
  const [connectionState, setConnectionState] = useState<RendererConnectionState>(apiBaseUrl ? "connecting" : "disconnected")
  const [selectedTradebookId, setSelectedTradebookId] = useState("")
  const [chartSymbol, setChartSymbol] = useState(window.cairo?.config?.chartSymbol ?? "SPY")
  const [chartDate, setChartDate] = useState(window.cairo?.config?.chartDate ?? new Date().toISOString().slice(0, 10))
  const [refreshing, setRefreshing] = useState(false)
  const [chartError, setChartError] = useState<string | null>(null)
  const refreshAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!apiBaseUrl) return
    const connection = new EngineConnection(apiBaseUrl, {
      onSnapshot: setSnapshot,
      onState: setConnectionState,
    })
    void connection.connect()
    return () => connection.close()
  }, [apiBaseUrl])

  useEffect(() => {
    refreshAbort.current?.abort()
    setRefreshing(false)
    return () => refreshAbort.current?.abort()
  }, [chartSymbol, chartDate])

  async function refreshChart() {
    if (!apiBaseUrl || !window.cairo?.commandToken || refreshing) return
    refreshAbort.current?.abort()
    const controller = new AbortController()
    refreshAbort.current = controller
    setRefreshing(true)
    setChartError(null)
    try {
      const response = await fetch(`${apiBaseUrl}/chart/refresh`, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.cairo.commandToken}` },
        body: JSON.stringify({ symbol: chartSymbol, date: chartDate }),
      })
      const result = await response.json() as { error?: string | null }
      if (!response.ok) setChartError(result.error ?? `Refresh failed (${response.status})`)
    } catch (error) {
      if (!controller.signal.aborted) setChartError(error instanceof Error ? error.message : "Refresh failed")
    } finally {
      if (!controller.signal.aborted) setRefreshing(false)
    }
  }

  const selectedTradebook = useMemo(
    () => snapshot?.tradebooks.find((tradebook) => tradebook.id === selectedTradebookId) ?? snapshot?.tradebooks[0] ?? null,
    [snapshot, selectedTradebookId],
  )
  const chartStatus = snapshot?.chart?.source ?? { ...EMPTY_STATUS, state: "disconnected" as const, detail: "No snapshot loaded" }
  const bookmapStatus = snapshot?.bookmap ?? { ...EMPTY_STATUS, source: "bookmap" as const }
  const brokerStatus = snapshot?.broker ?? { ...EMPTY_STATUS, source: "broker" as const }
  const copilotStatus = snapshot?.copilot ?? { ...EMPTY_STATUS, source: "copilot" as const }
  const sessionDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York",
  }).format(new Date()).toUpperCase()

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">C</span><span>Cairo</span></div>
        <div className="environment"><span className={`status-dot ${connectionTone(connectionState)}`} />LOCAL · {apiBaseUrl ? (window.cairo?.config?.provider ?? "fake").toUpperCase() : "PREVIEW"}</div>
        <button className="profile" aria-label="Local profile">LR</button>
      </header>

      <section className="workspace">
        <aside className="rail" aria-label="Workspace navigation">
          <button className="rail-button selected" aria-label="Trading workspace">◫</button>
          <button className="rail-button" aria-label="Tradebooks">▤</button>
          <button className="rail-button" aria-label="Settings">⚙</button>
          <div className="rail-bottom">?</div>
        </aside>

        <section className="main-column">
          <div className="page-heading">
            <div><p className="eyebrow">{sessionDate}</p><h1>Trading workspace</h1></div>
            <span className="market-pill"><span className={`status-dot ${connectionTone(connectionState)}`} />Engine {connectionLabel(connectionState)}</span>
          </div>

          <div className="source-row">
            <Source status={bookmapStatus} name="Bookmap" />
            <Source status={brokerStatus} name="Schwab" />
            <Source status={chartStatus} name="Chart data" />
            <Source status={copilotStatus} name="Cairo AI" />
          </div>
          {window.cairo?.config?.setupRequired && <div className="setup-notice" role="status">Setup needed · choose a Schwab account and review local source settings in {window.cairo.config.configPath}</div>}

          <section className="chart-card">
            <div className="card-heading">
              <div><span className="eyebrow">FOCUS CHART</span><h2>{snapshot?.chart?.symbol ?? "Chart context"}</h2></div>
              <div className="chart-controls">
                <input aria-label="Chart symbol" value={chartSymbol} maxLength={16} onChange={(event) => setChartSymbol(event.target.value.toUpperCase())} />
                <input aria-label="Chart date" type="date" value={chartDate} onChange={(event) => setChartDate(event.target.value)} />
                <button className="quiet-button" onClick={() => void refreshChart()} disabled={!apiBaseUrl || refreshing || !chartSymbol || !chartDate}>{refreshing ? "Loading…" : "Refresh"}</button>
              </div>
            </div>
            {snapshot?.chart?.bars.length ? (
              <>
                <ChartView bars={snapshot.chart.bars} symbol={snapshot.chart.symbol} />
                <div className="chart-loaded"><strong>{snapshot.chart.bars.length} one-minute bars · {snapshot.chart.source.state}</strong><span>Fetched {formatTime(snapshot.chart.fetchedAt)} · latest bar {snapshot.chart.latestBarAt ? formatTime(snapshot.chart.latestBarAt) : "unknown"}</span></div>
              </>
            ) : (
              <div className="empty-chart">
                <div className="chart-glyph">⌁</div>
                <strong>{snapshot?.chart ? "No bars for this date" : "No chart snapshot"}</strong>
                <span>{chartError ?? (apiBaseUrl ? "Select a symbol and date, then refresh for one-minute context." : "Desktop app required to load a chart snapshot.")}</span>
              </div>
            )}
            {chartError && snapshot?.chart?.bars.length ? <p className="chart-error" role="status">{chartError} · showing the last snapshot</p> : null}
            <p className="chart-footnote">Snapshot data only · no live chart updates · charting by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a></p>
          </section>

          <section className="setup-card">
            <div className="card-heading">
              <div><span className="eyebrow">TRADEBOOK</span><h2>Selected setup</h2></div>
              <select aria-label="Select setup" value={selectedTradebook?.id ?? ""} onChange={(event) => setSelectedTradebookId(event.target.value)} disabled={!snapshot?.tradebooks.length}>
                {snapshot?.tradebooks.length ? snapshot.tradebooks.map((book) => <option key={book.id} value={book.id}>{book.title}</option>) : <option value="">No tradebooks loaded</option>}
              </select>
            </div>
            {selectedTradebook ? (
              <div className="setup-detail">
                <strong>{selectedTradebook.title}</strong>
                <span>Revision {selectedTradebook.revision} · {selectedTradebook.interpretation ? `${selectedTradebook.interpretation.clauses.length} reviewed clauses` : "Interpretation not reviewed"}</span>
              </div>
            ) : <div className="empty-inline">No setup selected. Tradebooks you author will appear here.</div>}
            <p className="chart-footnote">Selection changes focus only; it does not attach or activate a plan.</p>
          </section>

          <section className="positions-card">
            <div className="card-heading"><div><span className="eyebrow">ACCOUNT MONITOR</span><h2>Positions</h2></div><span className="count">{snapshot?.positions.length ?? 0}</span></div>
            {snapshot?.positions.length ? (
              <div className="position-list">{snapshot.positions.map((position) => <div className="position-row" key={position.positionId}><strong>{position.symbol}</strong><span className={position.side}>{position.side}</span><span>{position.quantity} shares</span><span>{position.markPrice === null ? "Mark unavailable" : `$${position.markPrice.toFixed(2)}`}</span></div>)}</div>
            ) : <div className="empty-positions">{brokerStatus.state === "connected" ? "No open positions in the selected account." : "Connect a broker account to monitor open positions."}</div>}
          </section>

          <section className="tickets-card">
            <div className="card-heading"><div><span className="eyebrow">EXIT REVIEW</span><h2>Tickets</h2></div><span className="count">{snapshot?.tickets.length ?? 0}</span></div>
            {snapshot?.tickets.length ? snapshot.tickets.map((ticket) => <div className="ticket-row" key={ticket.id}><strong>{ticket.symbol} · {ticket.action}</strong><span>{ticket.quantity} shares · {ticket.reason}</span><small>{ticket.state} · expires {formatTime(ticket.expiresAt)}</small></div>) : <div className="empty-inline">No exit tickets need review.</div>}
          </section>
        </section>

        <aside className="copilot-column">
          <div className="copilot-heading"><div><span className="eyebrow">CAIRO COPILOT</span><h2>Trade assistant</h2></div><span className={`online-tag ${connectionTone(copilotStatus.state)}`}>{sourceLabel(copilotStatus.state).toUpperCase()}</span></div>
          <div className="copilot-body">
            <div className="assistant-avatar">C</div>
            <h3>Your trading copilot</h3>
            <p>I’ll help interpret your setup rules and monitor open positions. Entry decisions stay with you.</p>
            <div className="source-detail">Cairo AI: {sourceLabel(copilotStatus.state)}{copilotStatus.detail ? ` · ${copilotStatus.detail}` : ""}</div>
            <div className="suggestion">“What should I watch on this setup?” <span>↗</span></div>
            <div className="suggestion">“Review my attached tradebook” <span>↗</span></div>
          </div>
          <div className="composer-wrap">
            <div className="composer-placeholder">Ask Cairo about a setup…</div>
            <div className="composer-tools"><span>{connectionState === "connected" ? "Fake mode · no model connected" : "Engine connection unavailable"}</span><button disabled aria-label="Send message">↑</button></div>
          </div>
        </aside>
      </section>
      <footer className="statusbar"><span><span className="status-dot muted" />Observer-only entries</span><span>{snapshot ? `Runtime ${snapshot.runtimeInstanceId.slice(0, 8)} · sequence ${snapshot.sequence}` : connectionLabel(connectionState)}</span></footer>
    </main>
  )
}

function Source({ status, name }: { status: SourceStatus; name: string }) {
  return <div className="source"><span className={`status-dot ${connectionTone(status.state)}`} /><div><strong>{name}</strong><span>{sourceLabel(status.state)}{status.detail ? ` · ${status.detail}` : ""}</span></div></div>
}

function connectionTone(state: string): string {
  if (state === "connected") return "online"
  if (state === "stale" || state === "reconnecting" || state === "connecting") return "warning"
  return "offline"
}

function sourceLabel(state: string): string {
  return ({ connected: "Connected", disconnected: "Disconnected", stale: "Stale", waiting: "Waiting", unknown: "Unknown" } as Record<string, string>)[state] ?? state
}

function connectionLabel(state: RendererConnectionState): string {
  return ({ connected: "connected", connecting: "connecting", reconnecting: "reconnecting", disconnected: "disconnected" })[state]
}

function formatTime(value: string): string {
  const time = new Date(value)
  return Number.isFinite(time.getTime()) ? time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "unknown"
}
