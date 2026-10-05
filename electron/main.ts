import { app, BrowserWindow, shell } from "electron"
import path from "node:path"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { installShutdownHook } from "../src/engine/installShutdownHook.mts"
import { LocalConfiguration, type PublicConfiguration } from "../src/engine/LocalConfiguration.mts"
import { MassiveRestReader } from "../src/engine/MassiveRestReader.mts"
import { FetchHttpPort } from "../src/engine/FetchHttpPort.mts"
import { BookmapTokenProvider } from "../src/engine/BookmapTokenProvider.mts"
import { SchwabAccountReader } from "../src/engine/SchwabAccountReader.mts"
import { SchwabOrderReader } from "../src/engine/SchwabOrderReader.mts"
import { BrokerRefreshCoordinator } from "../src/engine/BrokerRefreshCoordinator.mts"
import { PreparationStore } from "../src/engine/PreparationStore.mts"
import { OpenCodeSidecar } from "../src/copilot/OpenCodeSidecar.mts"

// Main-process lifetime owns the engine; BrowserWindow reloads only replace the renderer.
const engine = new CairoEngine()
const apiServer = new EngineApiServer(engine)
let brokerCoordinator: BrokerRefreshCoordinator | undefined
let sidecar: OpenCodeSidecar | undefined
installShutdownHook(app, {
  stop: async () => {
    await sidecar?.stop()
    await brokerCoordinator?.stop()
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
  apiServer.setPreparationStore(new PreparationStore(app.getPath("userData")))
  await apiServer.loadPreparation()
  const http = new FetchHttpPort()
  const massive = new MassiveRestReader(http, () => configStore.massiveApiKey)
  apiServer.setChartRefresher((symbol, date) => massive.refresh(symbol, date))
  const tokenProvider = new BookmapTokenProvider(() => ({ selectedAccountId: configStore.values.selectedAccountId, schwabTokenFile: configStore.values.schwabTokenFile }))
  const accountReader = new SchwabAccountReader(http, tokenProvider)
  const orderReader = new SchwabOrderReader(http, tokenProvider)
  brokerCoordinator = new BrokerRefreshCoordinator(engine, accountReader, orderReader, { intervalMs: configStore.values.brokerPollIntervalMs })
  apiServer.setBrokerRefresher(async () => {
    const result = await brokerCoordinator!.refresh()
    return { status: result.status, error: result.error }
  })
  const apiBaseUrl = await apiServer.start()
  engine.start()
  brokerCoordinator.start()
  createWindow(apiBaseUrl, config)
  sidecar = new OpenCodeSidecar({
    binary: app.isPackaged ? path.join(process.resourcesPath, "opencode", "opencode.exe") : path.join(app.getAppPath(), "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
    userDataPath: app.getPath("userData"),
    onStatus: copilot => engine.updateSnapshot({ copilot }),
  })
  apiServer.setCopilotRestarter(() => sidecar!.restart())
  void sidecar.start()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(apiBaseUrl, config)
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
