export function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">C</span><span>Cairo</span></div>
        <div className="environment"><span className="status-dot" />LOCAL · FAKE MODE</div>
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
            <div><p className="eyebrow">SUNDAY, OCTOBER 4</p><h1>Trading workspace</h1></div>
            <span className="market-pill"><span className="status-dot muted" />Market closed</span>
          </div>

          <div className="source-row">
            <Source name="Bookmap" detail="Not connected" tone="offline" />
            <Source name="Schwab" detail="Waiting for setup" tone="offline" />
            <Source name="Chart data" detail="No snapshot loaded" tone="offline" />
          </div>

          <section className="chart-card">
            <div className="card-heading">
              <div><span className="eyebrow">FOCUS CHART</span><h2>Chart context</h2></div>
              <button className="quiet-button" disabled>Refresh</button>
            </div>
            <div className="empty-chart">
              <div className="chart-glyph">⌁</div>
              <strong>No chart snapshot</strong>
              <span>Select a symbol to load one-minute context.</span>
            </div>
            <p className="chart-footnote">Snapshot data only · no live chart updates</p>
          </section>

          <section className="positions-card">
            <div className="card-heading"><div><span className="eyebrow">ACCOUNT MONITOR</span><h2>Positions</h2></div><span className="count">0</span></div>
            <div className="empty-positions">Connect a broker account to monitor open positions.</div>
          </section>
        </section>

        <aside className="copilot-column">
          <div className="copilot-heading"><div><span className="eyebrow">CAIRO COPILOT</span><h2>Trade assistant</h2></div><span className="online-tag">READY</span></div>
          <div className="copilot-body">
            <div className="assistant-avatar">C</div>
            <h3>Your trading copilot</h3>
            <p>I’ll help interpret your setup rules and monitor open positions. Entry decisions stay with you.</p>
            <div className="suggestion">“What should I watch on this setup?” <span>↗</span></div>
            <div className="suggestion">“Review my attached tradebook” <span>↗</span></div>
          </div>
          <div className="composer-wrap">
            <div className="composer-placeholder">Ask Cairo about a setup…</div>
            <div className="composer-tools"><span>Fake mode · no model connected</span><button disabled aria-label="Send message">↑</button></div>
          </div>
        </aside>
      </section>
      <footer className="statusbar"><span><span className="status-dot muted" />Observer-only entries</span><span>Engine not started</span></footer>
    </main>
  )
}

function Source({ name, detail, tone }: { name: string; detail: string; tone: string }) {
  return <div className="source"><span className={`status-dot ${tone}`} /><div><strong>{name}</strong><span>{detail}</span></div></div>
}
