import { useEffect, useState } from "react"

export function SettingsPanel() {
  const [root, setRoot] = useState(window.cairo?.config?.tradebooks_root_path ?? "")
  const [workspace, setWorkspace] = useState(window.cairo?.config?.workspace_root_path ?? "")
  const [secretsFile, setSecretsFile] = useState(window.cairo?.config?.secretsFile ?? "")
  const [savedWorkspace, setSavedWorkspace] = useState(workspace)
  const [savedSecrets, setSavedSecrets] = useState(secretsFile)
  const [activeSecrets, setActiveSecrets] = useState(secretsFile)
  const [savedRoot, setSavedRoot] = useState(root)
  const [activeRoot, setActiveRoot] = useState(root)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const api = window.cairo?.documentSettings
  useEffect(() => {
    let active = true
    const adopt = (settings: { config: { tradebooks_root_path: string; workspace_root_path: string; secretsFile: string }; activeRoot: string; activeSecretsFile: string }) => {
      if (!active) return
      setRoot(settings.config.tradebooks_root_path)
      setSavedRoot(settings.config.tradebooks_root_path)
      setActiveRoot(settings.activeRoot)
      setWorkspace(settings.config.workspace_root_path)
      setSavedWorkspace(settings.config.workspace_root_path)
      setSecretsFile(settings.config.secretsFile)
      setSavedSecrets(settings.config.secretsFile)
      setActiveSecrets(settings.activeSecretsFile)
    }
    const unsubscribe = window.cairo?.onDocumentSettings?.(adopt)
    void api?.("read").then(adopt).catch(() => { if (active) setError("Settings could not be loaded.") })
    return () => { active = false; unsubscribe?.() }
  }, [])
  async function browse(field: "workspace_root_path" | "tradebooks_root_path" | "secretsFile") {
    if (!api) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const selected = await api("browse", field)
      if (selected) {
        if (field === "workspace_root_path") { setWorkspace(selected); await derive(selected) }
        else if (field === "secretsFile") setSecretsFile(selected)
        else setRoot(selected)
      }
    }
    catch { setError("Folder picker could not open.") }
    finally { setBusy(false) }
  }
  async function derive(value = workspace) {
    if (!api) return
    try {
      const paths = await api("derive", value)
      setRoot(paths.tradebooks_root_path); setSecretsFile(paths.secretsFile)
      setMessage("Paths filled from workspace root. Save settings to keep them.")
    } catch { setError("Enter an absolute workspace root path first.") }
  }
  async function save() {
    if (!api) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const settings = await api("save", { workspace_root_path: workspace, tradebooks_root_path: root, secretsFile })
      setRoot(settings.config.tradebooks_root_path)
      setSavedRoot(settings.config.tradebooks_root_path)
      setActiveRoot(settings.activeRoot)
      setSavedWorkspace(settings.config.workspace_root_path)
      setSavedSecrets(settings.config.secretsFile)
      setActiveSecrets(settings.activeSecretsFile)
      setMessage("Settings saved.")
    } catch (error) { setError(error instanceof Error ? error.message : "Settings could not be saved.") }
    finally { setBusy(false) }
  }
  return <section className="preparation-card settings-card">
    <div className="card-heading"><div><span className="eyebrow">WORKSPACE &amp; DOCUMENTS</span><h2>Settings</h2></div></div>
    <p className="notes-intro">Choose your shared workspace folder, then fill the usual tradebooks and secrets paths. You can adjust each path separately.</p>
    <label className="notes-label" htmlFor="workspace-root-path">Workspace root path</label>
    <div className="root-path-controls"><input id="workspace-root-path" value={workspace} disabled={!api || busy} onChange={event => { setWorkspace(event.target.value); setMessage(null); setError(null) }} /><button className="quiet-button" disabled={!api || busy} onClick={() => void browse("workspace_root_path")}>Browse…</button></div>
    <button className="quiet-button" disabled={!api || busy || !workspace.trim()} onClick={() => void derive()}>Use paths from workspace root</button>
    <p className="chart-footnote">Backtest/tradebooks · secrets/storeSecrets.js</p>
    <label className="notes-label" htmlFor="tradebooks-root-path">Tradebooks root path</label>
    <div className="root-path-controls">
      <input id="tradebooks-root-path" value={root} disabled={!api || busy} onChange={event => { setRoot(event.target.value); setMessage(null); setError(null) }} />
      <button className="quiet-button" disabled={!api || busy} onClick={() => void browse("tradebooks_root_path")}>Browse…</button>
    </div>
    <p className="chart-footnote">All human-authored trading documents belong here. Bookmap patterns use bookmap_patterns; preparation notes use preparation.</p>
    <label className="notes-label" htmlFor="secrets-file-path">Secrets file path</label>
    <div className="root-path-controls"><input id="secrets-file-path" value={secretsFile} disabled={!api || busy} placeholder="Optional storeSecrets.js file" onChange={event => { setSecretsFile(event.target.value); setMessage(null); setError(null) }} /><button className="quiet-button" disabled={!api || busy} onClick={() => void browse("secretsFile")}>Browse…</button></div>
    <button className="quiet-button" disabled={!api || busy || !root.trim() || (root.trim() === savedRoot && workspace.trim() === savedWorkspace && secretsFile.trim() === savedSecrets)} onClick={() => void save()}>{busy ? "Working…" : "Save settings"}</button>
    {message && <p className="notes-intro" role="status">{message}</p>}
    {error && <p className="chart-error" role="alert">{error}</p>}
    {(savedRoot !== activeRoot || savedSecrets !== activeSecrets) && <p className="notes-intro" role="status">Restart Cairo to use the saved paths. Current tradebooks root: {activeRoot}</p>}
    <p className="chart-footnote">Folder changes take effect after restarting Cairo. Existing documents stay in their folders.</p>
    {!api && <p className="chart-footnote">Open the desktop app to change settings.</p>}
  </section>
}
