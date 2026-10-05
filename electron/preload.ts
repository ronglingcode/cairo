import { contextBridge } from "electron"

const apiBaseUrl = process.argv.find((argument) => argument.startsWith("--cairo-api-url="))?.slice("--cairo-api-url=".length) ?? null

contextBridge.exposeInMainWorld("cairo", {
  runtime: "desktop",
  mode: "fake",
  apiBaseUrl,
})
