import { app, BrowserWindow } from "electron"
import path from "node:path"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { installShutdownHook } from "../src/engine/installShutdownHook.mts"

// Main-process lifetime owns the engine; BrowserWindow reloads only replace the renderer.
const engine = new CairoEngine()
installShutdownHook(app, engine)

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    title: "Cairo",
    backgroundColor: "#0b0e12",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"))
  }
}

app.whenReady().then(() => {
  engine.start()
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
