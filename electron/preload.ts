import { contextBridge, ipcRenderer } from "electron"

function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const apiBaseUrl = process.argv.find((argument) => argument.startsWith("--cairo-api-url="))?.slice("--cairo-api-url=".length) ?? null
const configArgument = process.argv.find((argument) => argument.startsWith("--cairo-public-config="))?.slice("--cairo-public-config=".length)
const commandToken = process.argv.find((argument) => argument.startsWith("--cairo-command-token="))?.slice("--cairo-command-token=".length) ?? null
let config: unknown = null
try { config = configArgument ? JSON.parse(decodeURIComponent(configArgument)) : null } catch { config = null }

contextBridge.exposeInMainWorld("cairo", {
  runtime: "desktop",
  mode: "fake",
  apiBaseUrl,
  config,
  documentSettings: (action: "read" | "browse" | "save" | "derive", value?: unknown) => ipcRenderer.invoke("cairo:document-settings", action, value),
  onDocumentSettings: (callback: (settings: unknown) => void) => subscribe("cairo:document-settings-changed", callback),
  commandToken,
  view: process.argv.includes("--cairo-view=chat") ? "chat" : "planning",
  chatWindow: (action: "detach" | "dock" | "state") => ipcRenderer.invoke("cairo:chat-window", action),
  onChatDetached: (callback: (detached: boolean) => void) => subscribe("cairo:chat-detached", callback),
  chatDraft: (draft?: string) => ipcRenderer.invoke("cairo:chat-draft", draft),
  onChatDraft: (callback: (draft: string) => void) => subscribe("cairo:chat-draft", callback),
})
