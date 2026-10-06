import { TicketPermissions } from "../src/copilot/TicketPermissions.mts"
import { BookmapReceiver } from "../src/engine/BookmapReceiver.mts"
import { stat } from "node:fs/promises"
import { EntryObserver } from "../src/engine/EntryObserver.mts"
import { RecoveryBootstrap } from "../src/engine/RecoveryBootstrap.mts"
import { UnknownReconciler } from "../src/engine/UnknownReconciler.mts"
import { ProtectionCoordinator } from "../src/engine/ProtectionCoordinator.mts"
import { ExitTickets } from "../src/engine/ExitTickets.mts"
import { RecoveryStore } from "../src/engine/RecoveryStore.mts"
import { ExitWriter } from "../src/engine/ExitWriter.mts"
import { CopilotWaker } from "../src/copilot/CopilotWaker.mts"
import { PartialManagement } from "../src/copilot/PartialManagement.mts"
import { managementAlert } from "./managementAlert"
import { TradebookStore } from "../src/engine/TradebookStore.mts"
import { BookmapPatterns } from "../src/engine/BookmapPatterns.mts"
import { PolicyReview } from "../src/engine/PolicyReview.mts"
import { ManagementTimeline } from "../src/engine/ManagementTimeline.mts"
import { app, BrowserWindow, shell, Notification, ipcMain, dialog } from "electron"
import path from "node:path"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { installShutdownHook } from "../src/engine/installShutdownHook.mts"
import { LocalConfiguration, type PublicConfiguration } from "../src/engine/LocalConfiguration.mts"
import { prepareUserDataDirectory } from "../src/engine/UserDataDirectory.mts"
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
import { SkillLibrary } from "../src/copilot/SkillLibrary.mts"
import { FakeModelServer } from "../src/copilot/FakeModelServer.mts"
import { modelConfiguration } from "../src/copilot/ModelConfiguration.mts"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"

// Home-folder storage follows Bookmap's user.home convention; overrides stay isolated.
app.setPath("userData", prepareUserDataDirectory(app.getPath("userData")))

// Main-process lifetime owns the engine; BrowserWindow reloads only replace the renderer.
const engine: CairoEngine = new CairoEngine({ runCycle: async (): Promise<void> => { bookmapReceiver.tick(); entryObserver.cycle(); startupRecovery?.cycle(); protection?.cycle(); guidance.reconcile(); monitor.cycle(); protection?.persist(monitor.checkpointState()); timeline.capture(); tickets.cycle(); writer?.reconcileKnown(); uncertainty?.tick(); partialManagement?.cycle(); if (!partialManagement?.ownsAutomaticChat) waker?.cycle() } })
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
let automaticChat: CopilotChat | undefined
let waker: CopilotWaker | undefined
let partialManagement: PartialManagement | undefined
let writer: ExitWriter | undefined
let protection: ProtectionCoordinator | undefined
let uncertainty: UnknownReconciler | undefined
let startupRecovery: RecoveryBootstrap | undefined
let ticketPermissions: TicketPermissions | undefined
let fakeModel: FakeModelServer | undefined
installShutdownHook(app, {
  stop: async () => {
    bookmapReceiver.stop()
    await bookmapReceiver.flushArchive()
    await ticketPermissions?.stop()
    await chat?.stop()
    await automaticChat?.stop()
    await writer?.stop()
    await uncertainty?.stop()
    await sidecar?.stop()
    await fakeModel?.stop()
    await brokerCoordinator?.stop()
    await apiServer.stop()
    await engine.stop()
  },
})

let planningWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let chatDraft = ""
const managedWindows = new Set<BrowserWindow>()
const hiddenWindowTest = process.env.CAIRO_WINDOW_TEST_MODE === "hidden"

function focusWindow(window: BrowserWindow): void {
  if (hiddenWindowTest) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function broadcast(channel: string, value: unknown): void {
  for (const window of managedWindows) if (!window.isDestroyed()) window.webContents.send(channel, value)
}

function createWindow(apiBaseUrl: string, config: PublicConfiguration, view: "planning" | "chat" = "planning"): BrowserWindow {
  const window = new BrowserWindow({
    show: !hiddenWindowTest,
    width: view === "chat" ? 720 : 1440,
    height: view === "chat" ? 860 : 940,
    minWidth: view === "chat" ? 420 : 960,
    minHeight: view === "chat" ? 540 : 640,
    title: view === "chat" ? "Cairo · Live chat" : "Cairo",
    backgroundColor: "#0b0e12",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !hiddenWindowTest,
      additionalArguments: [`--cairo-view=${view}`, `--cairo-api-url=${apiBaseUrl}`, `--cairo-public-config=${encodeURIComponent(JSON.stringify(config))}`, `--cairo-command-token=${apiServer.commandToken}`],
    },
  })
  managedWindows.add(window)
  window.setMenuBarVisibility(false)
  if (view === "chat") chatWindow = window
  else planningWindow = window
  window.on("closed", () => {
    managedWindows.delete(window)
    if (view === "chat") { chatWindow = null; broadcast("cairo:chat-detached", false) }
    else planningWindow = null
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
  return window
}

app.whenReady().then(async () => {
  const configStore = new LocalConfiguration(app.getPath("userData"))
  let config = await configStore.load()
  await bookmapReceiver.enableEntryArchive(app.getPath("userData"))
  bookmapReceiver.start(config.bookmapEndpoint)
  const tradebookPath = config.tradebooks_root_path
  try { apiServer.setPreparationStore(await PreparationStore.forTradebooksRoot(tradebookPath, app.getPath("userData"))) }
  catch (error) {
    engine.updateSnapshot({ preparationError: "Preparation notes could not be migrated. Existing files were preserved." })
    console.error("Cannot migrate preparation notes", error)
  }
  await apiServer.loadPreparation()
  const tradebookStore = new TradebookStore(app.getPath("userData"), tradebookPath)
  const bookmapPatterns = new BookmapPatterns(engine, app.getPath("userData"), tradebookPath)
  apiServer.setBookmapPatterns(bookmapPatterns)
  try { await bookmapPatterns.load() } catch (error) { engine.updateSnapshot({ bookmapPatternError: error instanceof Error ? error.message : "Bookmap pattern storage unavailable" }) }
  app.once("before-quit", () => bookmapPatterns.stop())
  try { engine.updateSnapshot({ tradebooks: await tradebookStore.list() }) } catch (error) { console.error(`Cannot load tradebooks from ${tradebookPath}`, error) }
  apiServer.setPolicyReview(new PolicyReview(engine, guidance, monitor))
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
  ipcMain.handle("cairo:document-settings", async (event, action: unknown, value: unknown) => {
    const window = [...managedWindows].find(window => window.webContents === event.sender)
    if (!window) throw new Error("Unknown Cairo window")
    if (action === "read") return { config, activeRoot: tradebookPath, activeSecretsFile: configStore.values.secretsFile }
    if (action === "derive" && typeof value === "string" && path.isAbsolute(value.trim())) {
      const root = path.resolve(value.trim())
      return { workspace_root_path: root, tradebooks_root_path: path.join(root, "Backtest", "tradebooks"), secretsFile: path.join(root, "secrets", "storeSecrets.js") }
    }
    if (action === "browse") {
      const file = value === "secretsFile"
      const workspace = value === "workspace_root_path"
      const result = await dialog.showOpenDialog(window, { title: file ? "Secrets file path" : workspace ? "Workspace root path" : "Tradebooks root path", defaultPath: file ? config.secretsFile : workspace ? config.workspace_root_path : config.tradebooks_root_path, properties: [file ? "openFile" : "openDirectory"] })
      return result.canceled ? null : result.filePaths[0]
    }
    if (action !== "save" || (!value || (typeof value !== "string" && typeof value !== "object"))) throw new Error("Invalid settings request")
    const input = typeof value === "string" ? { tradebooks_root_path: value, workspace_root_path: config.workspace_root_path, secretsFile: config.secretsFile } : value as Record<string, unknown>
    if (["tradebooks_root_path", "workspace_root_path", "secretsFile"].some(key => typeof input[key] !== "string")) throw new Error("Invalid settings paths")
    const candidate = (input.tradebooks_root_path as string).trim()
    const workspace = (input.workspace_root_path as string).trim()
    const secretsFile = (input.secretsFile as string).trim()
    if (!candidate || !path.isAbsolute(candidate)) throw new Error("Tradebooks root path must be an absolute path")
    let directory
    try { directory = await stat(candidate) } catch { throw new Error("Tradebooks root path must be an existing folder") }
    if (!directory.isDirectory()) throw new Error("Tradebooks root path must be a folder")
    if (!workspace || !path.isAbsolute(workspace)) throw new Error("Workspace root path must be an absolute path")
    try { if (!(await stat(workspace)).isDirectory()) throw new Error() } catch { throw new Error("Workspace root path must be an existing folder") }
    if (secretsFile) {
      if (!path.isAbsolute(secretsFile)) throw new Error("Secrets file path must be an absolute path")
      try { if (!(await stat(secretsFile)).isFile()) throw new Error() } catch { throw new Error("Secrets file path must be an existing file") }
    }
    // Saving paths must not change credentials used by the running trading session.
    const nextStore = new LocalConfiguration(app.getPath("userData"))
    await nextStore.load()
    config = await nextStore.save({ ...nextStore.values, tradebooks_root_path: candidate, workspace_root_path: workspace, secretsFile })
    const settings = { config, activeRoot: tradebookPath, activeSecretsFile: configStore.values.secretsFile }
    broadcast("cairo:document-settings-changed", settings)
    return settings
  })
  ipcMain.handle("cairo:chat-window", (event, action: unknown) => {
    if (![...managedWindows].some(window => window.webContents === event.sender)) throw new Error("Unknown Cairo window")
    if (action === "detach") {
      if (!chatWindow) createWindow(apiBaseUrl, config, "chat")
      focusWindow(chatWindow!)
      broadcast("cairo:chat-detached", true)
    } else if (action === "dock") {
      if (!planningWindow) createWindow(apiBaseUrl, config)
      focusWindow(planningWindow!)
      chatWindow?.close()
    }
    return Boolean(chatWindow)
  })
  ipcMain.handle("cairo:chat-draft", (event, draft: unknown) => {
    if (![...managedWindows].some(window => window.webContents === event.sender)) throw new Error("Unknown Cairo window")
    if (typeof draft === "string" && draft.length <= 8000) {
      chatDraft = draft
      for (const window of managedWindows) {
        if (!window.isDestroyed() && window.webContents !== event.sender) window.webContents.send("cairo:chat-draft", chatDraft)
      }
    }
    return chatDraft
  })
  engine.start()
  brokerCoordinator.start()
  createWindow(apiBaseUrl, config)
  const fake = configStore.values.provider === "fake"
  fakeModel = fake ? new FakeModelServer() : undefined
  const selectedModel = modelConfiguration(fake, configStore.values.model || "unconfigured", fakeModel ? await fakeModel.start() : "")
  const skills = new SkillLibrary(process.env.CAIRO_SKILLS_DIRECTORY || path.join(app.getAppPath(), "skills"))
  sidecar = new OpenCodeSidecar({
    binary: app.isPackaged ? path.join(process.resourcesPath, "opencode", "opencode.exe") : path.join(app.getAppPath(), "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
    userDataPath: app.getPath("userData"),
    pluginPath: app.isPackaged ? path.join(process.resourcesPath, "copilot", "cairo-plugin.js") : path.join(app.getAppPath(), "dist-copilot", "cairo-plugin.js"),
    config: selectedModel.config,
    environment: { CAIRO_TOOL_ENDPOINT: `${apiBaseUrl}/copilot/tools`, CAIRO_TOOL_TOKEN: apiServer.toolToken, CAIRO_SKILLS_DIRECTORY: skills.directory,
      ...(!fake && configStore.openAiApiKey ? { CAIRO_OPENAI_API_KEY: configStore.openAiApiKey } : {}),
    },
    onStatus: copilot => engine.updateSnapshot({ copilot }),
  })
  chat = new CopilotChat({ engine, client: () => sidecar?.client, workspace: sidecar.workspace, model: selectedModel.model, fake,
    skills,
    configured: () => fake || Boolean(configStore.values.model && configStore.openAiApiKey),
  })
  apiServer.setCopilotChat(chat)
  automaticChat = new CopilotChat({ engine, client: () => sidecar?.client, workspace: sidecar.workspace, model: selectedModel.model, fake,
    channel: "automatic", skills, configured: () => fake || Boolean(configStore.values.model && configStore.openAiApiKey),
  })
  apiServer.setCopilotAutomaticChat(automaticChat)
  waker = new CopilotWaker(engine, automaticChat)
  apiServer.setCopilotWaker(waker)
  partialManagement = new PartialManagement(engine, automaticChat, id => bookmapPatterns.managementRequest(id), symbol => {
    broadcast("cairo:management-alert", symbol)
    managementAlert(symbol, () => {
      const window = chatWindow ?? planningWindow
      if (window) focusWindow(window)
      broadcast("cairo:management-alert", symbol)
    })
  })
  apiServer.setPartialManagement(partialManagement)
  apiServer.setCopilotRestarter(async () => { await ticketPermissions?.stop(); await Promise.all([chat!.stop(), automaticChat!.stop()]); const ok = await sidecar!.restart(); if (ok) await Promise.all([chat!.connect(), automaticChat!.connect()]); return ok })
  const domainTools = new CairoDomainTools(engine, async id => {
    const client = sidecar?.client
    if (!client || !sidecar) return false
    const session = await client.session.get({ sessionID: id }, { signal: AbortSignal.timeout(5000) })
    return path.resolve(session.location.directory).toLowerCase() === path.resolve(sidecar.workspace).toLowerCase()
  })
  domainTools.setExitTickets(tickets)
  domainTools.setBookmapPatterns(bookmapPatterns)
  domainTools.setBookmapEvidence(bookmapReceiver.evidence)
  ticketPermissions = new TicketPermissions(tickets, () => sidecar?.client)
  domainTools.setTicketPermissions(ticketPermissions)
  apiServer.setTicketPermissions(ticketPermissions)
  apiServer.setDomainTools(domainTools)
  void sidecar.start().then(ok => { if (ok) return Promise.all([chat!.connect(), automaticChat!.connect()]) })
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(apiBaseUrl, config)
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})








