import { app, BrowserWindow, shell } from "electron"
import path from "node:path"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { installShutdownHook } from "../src/engine/installShutdownHook.mts"
import { LocalConfiguration, type PublicConfiguration } from "../src/engine/LocalConfiguration.mts"
import { MassiveRestReader } from "../src/engine/MassiveRestReader.mts"
import { FetchHttpPort } from "../src/engine/FetchHttpPort.mts"

// Main-process lifetime owns the engine; BrowserWindow reloads only replace the renderer.
const engine = new CairoEngine()
const apiServer = new EngineApiServer(engine)
installShutdownHook(app, {
  stop: async () => {
    await apiServer.stop()
    await engine.stop()
  },
})

function createWindow(apiBaseUrl: string, config: PublicConfiguration): void {
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
    additionalArguments: [`--cairo-api-url=${apiBaseUrl}`, `--cairo-public-config=${encodeURIComponent(JSON.stringify(config))}`, `--cairo-command-token=${apiServer.commandToken}`],
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "https://www.tradingview.com/") void shell.openExternal(url)
    return { action: "deny" }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"))
  }
}

app.whenReady().then(async () => {
  const configStore = new LocalConfiguration(app.getPath("userData"))
  const config = await configStore.load()
  const massive = new MassiveRestReader(new FetchHttpPort(), () => configStore.massiveApiKey)
  apiServer.setChartRefresher((symbol, date) => massive.refresh(symbol, date))
  const apiBaseUrl = await apiServer.start()
  engine.start()
  createWindow(apiBaseUrl, config)
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(apiBaseUrl, config)
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
