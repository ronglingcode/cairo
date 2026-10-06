import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { CairoEngine } from '../src/engine/CairoEngine.mts'
import { EngineApiServer } from '../src/engine/EngineApiServer.mts'
import { PreparationStore } from '../src/engine/PreparationStore.mts'
import { PositionGuidance } from '../src/engine/PositionGuidance.mts'
import { ManagementMonitor } from '../src/engine/ManagementMonitor.mts'
import { ManagementTimeline } from '../src/engine/ManagementTimeline.mts'
import { ExitTickets } from '../src/engine/ExitTickets.mts'
import { ExitWriter } from '../src/engine/ExitWriter.mts'
import { RecoveryStore } from '../src/engine/RecoveryStore.mts'
import { PolicyReview } from '../src/engine/PolicyReview.mts'
import { BookmapPatterns } from '../src/engine/BookmapPatterns.mts'
import { OpenCodeSidecar } from '../src/copilot/OpenCodeSidecar.mts'
import { CairoDomainTools } from '../src/copilot/CairoDomainTools.mts'
import { CopilotChat } from '../src/copilot/CopilotChat.mts'
import { TicketPermissions } from '../src/copilot/TicketPermissions.mts'
import { SkillLibrary } from '../src/copilot/SkillLibrary.mts'
import { FakeModelServer } from '../src/copilot/FakeModelServer.mts'
import { modelConfiguration } from '../src/copilot/ModelConfiguration.mts'
import { readReferencedSecrets } from '../src/engine/ReferencedSecrets.mts'
import { loadScenario, SimulationBroker } from './simulation.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const caseId = args.find(arg => /^\d{4}-\d{2}-\d{2}-[A-Z][A-Z0-9.-]*$/.test(arg)) ?? '2026-10-05-PCVX'
if (!/^\d{4}-\d{2}-\d{2}-[A-Z][A-Z0-9.-]{0,15}$/.test(caseId)) throw new Error('Use a date-symbol case ID')
let config = {}
try { config = JSON.parse(await readFile(path.join(process.env.CAIRO_USER_DATA || path.join(os.homedir(), 'cairo'), 'config.json'), 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
const fake = args.includes('--fake') || args.includes('--smoke')
const secretsFile = option('--secrets-file') || config.secretsFile
const key = fake ? null : process.env.CAIRO_OPENAI_API_KEY || (secretsFile ? (await readReferencedSecrets(secretsFile)).openai?.apiKey : null)
if (!fake && !key) throw new Error('OpenAI key unavailable. Use Cairo’s saved secrets reference, --secrets-file PATH, or CAIRO_OPENAI_API_KEY. Use --fake only for UI verification.')
const model = option('--model') || config.model || 'gpt-6.1-sol'
const sourceRoot = path.resolve(option('--tradebooks-root') || config.tradebooks_root_path || path.join(repo, '../Backtest/tradebooks'))
const profile = await mkdtemp(path.join(os.tmpdir(), `Cairo-${caseId}-`))
const engine = new CairoEngine(); const api = new EngineApiServer(engine)
let sidecar, chat, permissions, provider, patterns, writer, server, timer
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true; clearInterval(timer); patterns?.stop()
  await permissions?.stop(); await writer?.stop(); await chat?.stop(); await sidecar?.stop(); await provider?.stop(); await api.stop(); await engine.stop()
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith(`Cairo-${caseId}-`)) throw new Error('Refusing to remove a profile outside the simulator temporary directory')
  await rm(profile, { recursive: true, force: true })
}
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop())
try {
  const { scenario, book, preparation } = await loadScenario(path.join(repo, 'test-cases', caseId), sourceRoot, profile)
  engine.updateSnapshot({ tradebooks: [book], preparation })
  const broker = new SimulationBroker(engine, scenario)
  api.setPreparationStore(new PreparationStore(profile))
  api.setBrokerRefresher(async () => { await broker.refresh(); return { status: engine.getSnapshot().broker, error: null } })
  api.setChartRefresher(async () => ({ ok: false, snapshot: null, error: 'This first case supplies no chart or live market data. Do not infer price triggers.' }))
  const guidance = new PositionGuidance(engine); const monitor = new ManagementMonitor(engine, guidance)
  const timeline = new ManagementTimeline(engine); const tickets = new ExitTickets(engine)
  tickets.setPreflight(() => { guidance.reconcile(); monitor.cycle() })
  api.setPositionGuidance(guidance); api.setManagementMonitor(monitor); api.setExitTickets(tickets)
  api.setPolicyReview(new PolicyReview(engine, guidance, monitor))
  const recovery = new RecoveryStore(profile); await recovery.load()
  writer = new ExitWriter({ engine, tickets, recovery, monitor, http: broker, tokens: broker.tokens, refresh: () => broker.refresh() })
  api.setExitWriter(writer)
  patterns = new BookmapPatterns(engine, profile, sourceRoot); await patterns.load(); api.setBookmapPatterns(patterns)
  const base = await api.start()
  provider = fake ? new FakeModelServer() : undefined
  const selected = modelConfiguration(fake, model, provider ? await provider.start() : '')
  const skills = new SkillLibrary(path.join(repo, 'skills'))
  sidecar = new OpenCodeSidecar({ binary: path.join(repo, 'node_modules/@opencode/cli/bin/opencode.exe'), userDataPath: profile, pluginPath: path.join(repo, 'dist-copilot/cairo-plugin.js'), config: selected.config,
    environment: { CAIRO_TOOL_ENDPOINT: `${base}/copilot/tools`, CAIRO_TOOL_TOKEN: api.toolToken, CAIRO_SKILLS_DIRECTORY: skills.directory, ...(!fake ? { CAIRO_OPENAI_API_KEY: key } : {}) }, onStatus: copilot => engine.updateSnapshot({ copilot }) })
  chat = new CopilotChat({ engine, client: () => sidecar.client, workspace: sidecar.workspace, model: selected.model, fake, configured: () => true, skills })
  permissions = new TicketPermissions(tickets, () => sidecar.client)
  const tools = new CairoDomainTools(engine, async id => (await sidecar.client.session.get({ sessionID: id })).location.directory === sidecar.workspace)
  tools.setExitTickets(tickets); tools.setTicketPermissions(permissions); tools.setBookmapPatterns(patterns)
  api.setDomainTools(tools); api.setCopilotChat(chat); api.setTicketPermissions(permissions)
  api.setCopilotRestarter(async () => { await permissions.stop(); await chat.stop(); const ok = await sidecar.restart(); if (ok) await chat.connect(); return ok })
  timer = setInterval(() => { void broker.refresh(); guidance.reconcile(); monitor.cycle(); timeline.capture(); tickets.cycle(); writer.reconcileKnown() }, 1000)
  const dist = path.join(repo, 'dist')
  server = createServer(async (request, response) => {
    try {
      const route = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      if (route === '/simulation/control' && request.method === 'POST') {
        if (request.headers.authorization !== `Bearer ${api.commandToken}`) { response.writeHead(401).end(); return }
        let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 4096) throw new Error('Oversized command') }
        const command = JSON.parse(raw)
        if (command.action === 'fill') await broker.fill(command.orderId)
        else if (command.action === 'reject') await broker.reject(command.orderId)
        else throw new Error('Unknown simulator control')
        writer.reconcileKnown(); guidance.reconcile(); monitor.cycle()
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true })); return
      }
      const file = path.resolve(dist, `.${route === '/' ? '/index.html' : route}`)
      if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return }
      let content = await readFile(file); const extension = path.extname(file)
      if (extension === '.html') {
        const bridge = { apiBaseUrl: base, commandToken: api.commandToken, simulation: { caseId, positionDescription: `${scenario.position.quantity} ${scenario.position.side} shares at $${scenario.position.averagePrice}` }, config: { provider: fake ? 'fake' : 'openai', model: fake ? 'fixture' : model, chartSymbol: scenario.symbol, chartDate: scenario.date, setupRequired: false } }
        const json = JSON.stringify(bridge).replaceAll('<', '\\u003c')
        content = Buffer.from(content.toString().replace('<head>', `<head><script>window.cairo=${json}</script>`))
      }
      response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' })[extension] || 'application/octet-stream' }).end(content)
    } catch (error) { response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  if (!await sidecar.start()) throw new Error('OpenCode could not start')
  await chat.connect()
  console.log(`SIMULATION ${caseId}: http://127.0.0.1:${server.address().port}/\n${fake ? 'Canned AI: UI smoke only' : `Real AI: ${model}; sending chat uses your API account`}. Synthetic broker only. Restart launcher to reset. Ctrl+C to stop.`)
  if (args.includes('--smoke')) {
    const snapshot = engine.getSnapshot()
    if (snapshot.positions[0]?.symbol !== scenario.symbol || snapshot.preparation.tradebookAssignments[0].tradebookId !== book.id) throw new Error('Scenario did not reach engine')
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`)
    if (!response.ok || !(await response.text()).includes(caseId)) throw new Error('UI bridge unavailable')
    console.log('PASS: scenario, isolated broker, real OpenCode startup, chat connection and UI bridge')
    await stop()
  }
} catch (error) { await stop(); throw error }
