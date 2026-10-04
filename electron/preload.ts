import { contextBridge } from "electron"

contextBridge.exposeInMainWorld("cairo", {
  runtime: "desktop",
  mode: "fake",
})
