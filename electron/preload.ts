import { contextBridge } from "electron"

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
  commandToken,
})
