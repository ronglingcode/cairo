import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { PreparationStore } from "../src/engine/PreparationStore.mts"
import { OpenCodeSidecar } from "../src/copilot/OpenCodeSidecar.mts"
import { CairoDomainTools } from "../src/copilot/CairoDomainTools.mts"
import { CopilotChat } from "../src/copilot/CopilotChat.mts"
import { SkillLibrary } from "../src/copilot/SkillLibrary.mts"
import { FakeModelServer } from "../src/copilot/FakeModelServer.mts"
import { modelConfiguration } from "../src/copilot/ModelConfiguration.mts"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"
import { ManagementTimeline } from "../src/engine/ManagementTimeline.mts"
import { ExitTickets } from "../src/engine/ExitTickets.mts"
import { PolicyReview } from "../src/engine/PolicyReview.mts"
import { GuidanceProposals } from "../src/engine/GuidanceProposals.mts"
import { CopilotWaker } from "../src/copilot/CopilotWaker.mts"

// Source preview with synthetic market facts and disposable storage; no real provider/broker.
const root = await mkdtemp(path.join(os.tmpdir(), "Cairo preview "))
const engine = new CairoEngine()
const api = new EngineApiServer(engine)
api.setPreparationStore(new PreparationStore(root))
await api.loadPreparation()
const guidance = new PositionGuidance(engine); const monitor = new ManagementMonitor(engine, guidance)
const timeline = new ManagementTimeline(engine); const tickets = new ExitTickets(engine)
tickets.setPreflight(() => { guidance.reconcile(); monitor.cycle() })
api.setPositionGuidance(guidance); api.setManagementMonitor(monitor); api.setExitTickets(tickets)
api.setPolicyReview(new PolicyReview(engine, guidance, monitor))
if (process.argv.includes("--management")) {
  const { positionEngine, attachmentRequest } = await import("../tests/fixtures/positions.mjs")
  const fixture = positionEngine().getSnapshot()
  engine.updateSnapshot({ positions: fixture.positions, broker: fixture.broker, brokerFacts: fixture.brokerFacts, brokerFactsRevision: fixture.brokerFactsRevision, tradebooks: fixture.tradebooks })
  guidance.attach(attachmentRequest(engine)); guidance.attach(attachmentRequest(engine, 1, "whole")); monitor.cycle()
  const book = fixture.tradebooks[1]
  const preparation = await new PreparationStore(root).save({ markdown: book.markdown, date: null, symbol: "BBB" }, null)
  engine.updateSnapshot({ preparation })
  new GuidanceProposals(engine).propose({ tradebookId: "reviewed-whole", expectedPreparationRevision: preparation.revision, expectedTradebookRevision: null, clauses: book.interpretation.clauses, management: book.interpretation.management }, "synthetic-preview")
}
const managementTimer = setInterval(() => {
  if (process.argv.includes("--management")) { const facts = engine.getSnapshot().brokerFacts; facts.asOf = new Date().toISOString(); facts.source.updatedAt = facts.asOf; engine.updateSnapshot({ brokerFacts: facts, broker: facts.source }) }
  guidance.reconcile(); monitor.cycle(); timeline.capture(); tickets.cycle()
}, 1000)
const base = await api.start()
const provider = new FakeModelServer()
const selected = modelConfiguration(true, "", await provider.start())
const skills = new SkillLibrary(path.resolve("skills"))
const sidecar = new OpenCodeSidecar({ binary: path.resolve("node_modules/@opencode/cli/bin/opencode.exe"), userDataPath: root,
  pluginPath: path.resolve("dist-copilot/cairo-plugin.js"), config: selected.config,
  environment: { CAIRO_TOOL_ENDPOINT: `${base}/copilot/tools`, CAIRO_TOOL_TOKEN: api.toolToken, CAIRO_SKILLS_DIRECTORY: skills.directory }, onStatus: copilot => engine.updateSnapshot({ copilot }),
})
const chat = new CopilotChat({ engine, client: () => sidecar.client, workspace: sidecar.workspace, model: selected.model, fake: true, configured: () => true, skills })
api.setCopilotChat(chat)
const tools = new CairoDomainTools(engine, async id => (await sidecar.client.session.get({ sessionID: id })).location.directory === sidecar.workspace)
tools.setExitTickets(tickets); api.setDomainTools(tools)
const waker = new CopilotWaker(engine, chat); api.setCopilotWaker(waker)
const wakeTimer = setInterval(() => waker.cycle(), 1000)
api.setCopilotRestarter(async () => { await chat.stop(); const ok = await sidecar.restart(); if (ok) await chat.connect(); return ok })
api.setChartRefresher(async symbol => {
  const fetchedAt = new Date().toISOString()
  const start = Date.parse("2026-10-02T13:30:00Z")
  const bars = Array.from({ length: 60 }, (_, index) => ({ time: start + index * 60_000, open: 500 + index * .05, high: 500.3 + index * .05, low: 499.8 + index * .05, close: 500.1 + index * .05, volume: 1000 + index * 30 }))
  return { ok: true, snapshot: { symbol, interval: "1m", fetchedAt, latestBarAt: new Date(bars.at(-1).time).toISOString(), bars, source: { source: "chart", state: "connected", updatedAt: fetchedAt, detail: "Synthetic preview fixture" } } }
})
const dist = path.resolve("dist")
const server = createServer(async (request, response) => {
  try {
    const route = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname)
    const file = path.resolve(dist, `.${route === "/" ? "/index.html" : route}`)
    if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return }
    let content = await readFile(file)
    const extension = path.extname(file)
    if (extension === ".html") {
      const bridge = { apiBaseUrl: base, commandToken: api.commandToken, config: { provider: "fake", model: "fixture", chartSymbol: "SPY", chartDate: "2026-10-02", setupRequired: false } }
      content = Buffer.from(content.toString().replace("<head>", `<head><script>window.cairo=${JSON.stringify(bridge)}</script>`))
    }
    response.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".css": "text/css", ".js": "text/javascript" })[extension] ?? "application/octet-stream" }).end(content)
  } catch { response.writeHead(404).end() }
})
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  clearInterval(managementTimer); clearInterval(wakeTimer)
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await chat.stop(); await sidecar.stop(); await provider.stop(); await api.stop(); await engine.stop()
  await rm(root, { recursive: true, force: true })
}
process.once("SIGINT", () => void stop())
process.once("SIGTERM", () => void stop())
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
console.log(`Fake preview: http://127.0.0.1:${server.address().port}/ (synthetic data; temporary notes)`)
if (await sidecar.start()) await chat.connect()
