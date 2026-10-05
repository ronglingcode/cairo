import { TicketPermissions } from "../src/copilot/TicketPermissions.mts"
import { BookmapReceiver } from "../src/engine/BookmapReceiver.mts"
import { seedPersonalReferences } from "../src/engine/PersonalReferences.mts"
import { EntryObserver } from "../src/engine/EntryObserver.mts"
import { RecoveryBootstrap } from "../src/engine/RecoveryBootstrap.mts"
import { UnknownReconciler } from "../src/engine/UnknownReconciler.mts"
import { ProtectionCoordinator } from "../src/engine/ProtectionCoordinator.mts"
import { ExitTickets } from "../src/engine/ExitTickets.mts"
import { RecoveryStore } from "../src/engine/RecoveryStore.mts"
import { ExitWriter } from "../src/engine/ExitWriter.mts"
import { CopilotWaker } from "../src/copilot/CopilotWaker.mts"
import { TradebookStore } from "../src/engine/TradebookStore.mts"
import { PolicyReview } from "../src/engine/PolicyReview.mts"
import { ManagementTimeline } from "../src/engine/ManagementTimeline.mts"
import { app, BrowserWindow, shell, Notification } from "electron"
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
import { CairoDomainTools } from "../src/copilot/CairoDomainTools.mts"
import { CopilotChat } from "../src/copilot/CopilotChat.mts"
import { FakeModelServer } from "../src/copilot/FakeModelServer.mts"
import { modelConfiguration } from "../src/copilot/ModelConfiguration.mts"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"

// Optional isolated profile for private portable use and synthetic package verification.
if (process.env.CAIRO_USER_DATA) app.setPath("userData", path.resolve(process.env.CAIRO_USER_DATA))

// Main-process lifetime owns the engine; BrowserWindow reloads only replace the renderer.
const engine: CairoEngine = new CairoEngine({ runCycle: async (): Promise<void> => { bookmapReceiver.tick(); entryObserver.cycle(); startupRecovery?.cycle(); protection?.cycle(); guidance.reconcile(); monitor.cycle(); protection?.persist(monitor.checkpointState()); timeline.capture(); tickets.cycle(); writer?.reconcileKnown(); uncertainty?.tick(); waker?.cycle() } })
const guidance = new PositionGuidance(engine)
const bookmapReceiver = new BookmapReceiver(engine)
const entryObserver = new EntryObserver(engine)
const monitor = new ManagementMonitor(engine, guidance)
const tickets = new ExitTickets(engine)
tickets.setPreflight(() => { protection?.cycle(); guidance.reconcile(); monitor.cycle() })
const timeline = new ManagementTimeline(engine, text => { if (Notification.isSupported()) new Notification({ title: "Cairo management recommendation", body: text }).show() })
const apiServer = new EngineApiServer(engine)
apiServer.setEntryObserver(entryObserver)
apiServer.setPositionGuidance(guidance)
apiServer.setManagementMonitor(monitor)
apiServer.setExitTickets(tickets)
let brokerCoordinator: BrokerRefreshCoordinator | undefined
let sidecar: OpenCodeSidecar | undefined
let chat: CopilotChat | undefined
let waker: CopilotWaker | undefined
let writer: ExitWriter | undefined
let protection: ProtectionCoordinator | undefined
let uncertainty: UnknownReconciler | undefined
let startupRecovery: RecoveryBootstrap | undefined
let ticketPermissions: TicketPermissions | undefined
let fakeModel: FakeModelServer | undefined
installShutdownHook(app, {
  stop: async () => {
    bookmapReceiver.stop()
    await ticketPermissions?.stop()
    await chat?.stop()
    await writer?.stop()
    await uncertainty?.stop()
    await sidecar?.stop()
    await fakeModel?.stop()
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
  bookmapReceiver.start(config.bookmapEndpoint)
  apiServer.setPreparationStore(new PreparationStore(app.getPath("userData")))
  await apiServer.loadPreparation()
  const tradebookStore = new TradebookStore(app.getPath("userData"))
  await seedPersonalReferences(tradebookStore, path.join(app.getAppPath(), "resources/references")).catch(() => { /* Missing/corrupt references remain unavailable. */ })
  try { engine.updateSnapshot({ tradebooks: await tradebookStore.list() }) } catch { /* Invalid artifacts remain inactive. */ }
  apiServer.setPolicyReview(new PolicyReview(engine, tradebookStore, guidance, monitor))
  const http = new FetchHttpPort()
  const massive = new MassiveRestReader(http, () => configStore.massiveApiKey)
  apiServer.setChartRefresher((symbol, date) => massive.refresh(symbol, date))
  const tokenProvider = new BookmapTokenProvider(() => ({ selectedAccountId: configStore.values.selectedAccountId, schwabTokenFile: configStore.values.schwabTokenFile }))
  const accountReader = new SchwabAccountReader(http, tokenProvider)
  const orderReader = new SchwabOrderReader(http, tokenProvider)
  brokerCoordinator = new BrokerRefreshCoordinator(engine, accountReader, orderReader, { intervalMs: configStore.values.brokerPollIntervalMs })
  const recovery = new RecoveryStore(app.getPath("userData"))
  let recoveryReady = false
  try {
    await recovery.load()
    await recovery.change(current => ({ ...current, attempts: current.attempts.map(item => ({ ...item, ticket: { ...item.ticket, state: "invalidated" }, state: item.state === "checkpointed" ? "unknown" : item.state })) }))
    recoveryReady = true
  } catch { engine.updateSnapshot({ recoveryError: "Recovery file needs manual resolution before broker writes" }) }
  if (recovery.available && recoveryReady) {
    startupRecovery = new RecoveryBootstrap(engine, recovery, monitor)
    protection = new ProtectionCoordinator(engine, recovery)
    uncertainty = new UnknownReconciler(engine, recovery, http, tokenProvider)
    apiServer.setUnknownReconciler(uncertainty)
    writer = new ExitWriter({ engine, tickets, recovery, monitor, http, tokens: tokenProvider, refresh: async () => { await brokerCoordinator!.refresh() } })
    apiServer.setExitWriter(writer)
  }
  apiServer.setBrokerRefresher(async () => {
    const result = await brokerCoordinator!.refresh()
    return { status: result.status, error: result.error }
  })
  const apiBaseUrl = await apiServer.start()
  engine.start()
  brokerCoordinator.start()
  createWindow(apiBaseUrl, config)
  const fake = configStore.values.provider === "fake"
  fakeModel = fake ? new FakeModelServer() : undefined
  const selectedModel = modelConfiguration(fake, configStore.values.model || "unconfigured", fakeModel ? await fakeModel.start() : "")
  sidecar = new OpenCodeSidecar({
    binary: app.isPackaged ? path.join(process.resourcesPath, "opencode", "opencode.exe") : path.join(app.getAppPath(), "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
    userDataPath: app.getPath("userData"),
    pluginPath: app.isPackaged ? path.join(process.resourcesPath, "copilot", "cairo-plugin.js") : path.join(app.getAppPath(), "dist-copilot", "cairo-plugin.js"),
    config: selectedModel.config,
    environment: { CAIRO_TOOL_ENDPOINT: `${apiBaseUrl}/copilot/tools`, CAIRO_TOOL_TOKEN: apiServer.toolToken,
      ...(!fake && configStore.openAiApiKey ? { CAIRO_OPENAI_API_KEY: configStore.openAiApiKey } : {}),
    },
    onStatus: copilot => engine.updateSnapshot({ copilot }),
  })
  chat = new CopilotChat({ engine, client: () => sidecar?.client, workspace: sidecar.workspace, model: selectedModel.model, fake,
    configured: () => fake || Boolean(configStore.values.model && configStore.openAiApiKey),
  })
  apiServer.setCopilotChat(chat)
  waker = new CopilotWaker(engine, chat)
  apiServer.setCopilotWaker(waker)
  apiServer.setCopilotRestarter(async () => { await ticketPermissions?.stop(); await chat!.stop(); const ok = await sidecar!.restart(); if (ok) await chat!.connect(); return ok })
  const domainTools = new CairoDomainTools(engine, async id => {
    const client = sidecar?.client
    if (!client || !sidecar) return false
    const session = await client.session.get({ sessionID: id }, { signal: AbortSignal.timeout(5000) })
    return path.resolve(session.location.directory).toLowerCase() === path.resolve(sidecar.workspace).toLowerCase()
  })
  domainTools.setExitTickets(tickets)
  ticketPermissions = new TicketPermissions(tickets, () => sidecar?.client)
  domainTools.setTicketPermissions(ticketPermissions)
  apiServer.setTicketPermissions(ticketPermissions)
  apiServer.setDomainTools(domainTools)
  void sidecar.start().then(ok => { if (ok) return chat!.connect() })
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(apiBaseUrl, config)
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})








