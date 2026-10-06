import { execFile } from "node:child_process"
import { Notification, shell } from "electron"

/** Windows speech runs outside the renderer, so muted/background chat windows still remind the trader. */
export function managementAlert(symbol: string, focusChat: () => void, needsContext = false): void {
  const body = needsContext ? `${symbol}. Partial taken. Your Bookmap pattern needs reconfirmation. Please check Cairo.` : `${symbol}. Your manage trade response is ready. Please review the stop loss and targets.`
  if (Notification.isSupported()) {
    const notification = new Notification({ title: `${symbol} · ${needsContext ? "Confirm Bookmap pattern" : "Manage trade ready"}`, body, silent: true })
    notification.on("click", focusChat)
    notification.show()
  }
  if (process.platform !== "win32") { shell.beep(); return }
  const script = `[System.Media.SystemSounds]::Exclamation.Play(); Add-Type -AssemblyName System.Speech; $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $speaker.Speak($env:CAIRO_MANAGEMENT_ALERT) } finally { $speaker.Dispose() }`
  execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    windowsHide: true, timeout: 20_000, env: { ...process.env, CAIRO_MANAGEMENT_ALERT: body },
  }, error => { if (error) { console.error("Cairo voice reminder failed", error.message); shell.beep() } })
}
