import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { CairoDomainTools } from "../src/copilot/CairoDomainTools.mts"
import { createCairoPlugin } from "../src/copilot/cairo-plugin.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { OpenCodeSidecar } from "../src/copilot/OpenCodeSidecar.mts"
import { build } from "esbuild"
import { createServer } from "node:http"
import { isBuiltin } from "node:module"

test("domain reads are bounded, preserve snapshot coverage, and reject unrelated sessions", async () => {
  const engine = new CairoEngine()
  engine.updateSnapshot({ preparation: { markdown: "x".repeat(20_000), revision: "a".repeat(64), date: null, symbol: null, savedAt: "2026-10-04T00:00:00Z" } })
  const tools = new CairoDomainTools(engine, async id => id === "cairo-session")
  const context = await tools.execute("read_context", {}, "cairo-session")
  assert.equal(context.preparation.markdown.length, 12_000)
  assert.equal(context.preparation.truncated, true)
  assert.equal(context.chart.livePriceAvailable, false)
  assert.equal(context.capabilities.brokerWrites, false)
  await assert.rejects(tools.execute("read_context", {}, "foreign-session"), /another location/)
  await assert.rejects(tools.execute("read_positions", { token: "unexpected" }, "cairo-session"), /no parameters/)
})

test("note proposals are revision-bound, expire, and never apply guidance or submit requests", async () => {
  let now = Date.parse("2026-10-04T00:00:00Z")
  const engine = new CairoEngine()
  const notes = { markdown: "Original notes", revision: "a".repeat(64), date: null, symbol: null, savedAt: new Date(now).toISOString() }
  engine.updateSnapshot({ preparation: notes })
  const tools = new CairoDomainTools(engine, async () => true, () => now)
  const result = await tools.execute("propose_notes", { markdown: "Proposed notes", date: null, symbol: null, expectedRevision: notes.revision }, "owned-session")
  assert.equal(result.applied, false)
  assert.equal(tools.proposals.length, 1)
  assert.deepEqual(engine.getSnapshot().preparation, notes)
  await assert.rejects(tools.execute("propose_notes", { markdown: "Stale", date: null, symbol: null, expectedRevision: null }, "owned-session"), /revision changed/)
  assert.equal((await tools.execute("stage_exit", { intent: "close", symbol: "SPY", quantity: 1 }, "owned-session")).available, false)
  await assert.rejects(tools.execute("propose_guidance", { text: "Review my position" }, "owned-session"), /Unsupported guidance/)
  await assert.rejects(tools.execute("stage_exit", { intent: "open", symbol: "SPY", quantity: 1 }, "owned-session"), /opening, increasing, and reversing/)
  assert.equal(engine.getSnapshot().tickets.length, 0)
  now += 5 * 60_000 + 1
  assert.equal(tools.proposals.length, 0)
})

test("Cairo plugin replaces coding tools with only Cairo domain tools", async () => {
  const catalog = new Map([["bash", { id: "bash" }], ["read", { id: "read" }]])
  const plugin = createCairoPlugin(async (operation, input) => ({ operation, input }))
  await plugin.setup({ session: { hook: async () => {} }, tool: { transform: async callback => callback({
    list: () => [...catalog.values()], remove: id => catalog.delete(id), namespace: () => {},
    add: tool => catalog.set(`cairo_${tool.name}`, tool),
  }) } })
  assert.equal(catalog.size, 13)
  assert.ok([...catalog.keys()].every(name => name.startsWith("cairo_")))
  const result = await catalog.get("cairo_read_context").execute({}, {})
  assert.equal(JSON.parse(result.content).operation, "read_context")
  assert.equal(catalog.get("cairo_stage_exit").options.codemode, false)
  assert.equal(catalog.get("cairo_interpret_bookmap_observation").options.permission, "cairo_propose")
})

test("domain bridge requires its own backend capability rather than the renderer command token", async t => {
  const engine = new CairoEngine()
  const api = new EngineApiServer(engine)
  api.setDomainTools(new CairoDomainTools(engine, async () => true))
  const base = await api.start()
  t.after(() => api.stop())
  const call = token => fetch(`${base}/copilot/tools`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ operation: "read_context", input: {}, sessionId: "owned" }) })
  assert.equal((await call(api.commandToken)).status, 403)
  assert.equal((await call(api.toolToken)).status, 200)
})

test("self-contained Cairo plugin bundle loads in the actual pinned runtime", { timeout: 45_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "Cairo plugin "))
  const pluginPath = path.join(root, "bundled-plugin.js")
  const bundle = await build({ entryPoints: ["src/copilot/cairo-plugin.mts"], bundle: true, platform: "node", format: "esm", outfile: pluginPath, metafile: true })
  assert.ok(Object.values(bundle.metafile.outputs).every(output => output.imports.every(entry => entry.external && isBuiltin(entry.path))))
  let exposed = []
  const engine = new CairoEngine()
  const api = new EngineApiServer(engine)
  const base = await api.start()
  const observed = []
  let calls = 0
  const provider = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    exposed = input.tools?.map(tool => tool.function.name) ?? []
    observed.push(JSON.stringify(input.messages))
    calls++
    if (calls === 1) {
      const asOf = new Date().toISOString()
      const position = { positionId: "outside-position", symbol: "SPY", side: "long", quantity: 7, averagePrice: 500, markPrice: 501 }
      const source = { source: "broker", state: "connected", updatedAt: asOf, detail: "fixture" }
      engine.updateSnapshot({ positions: [position], broker: source, brokerFactsRevision: 2,
        brokerFacts: { accountId: "fixture-account", asOf, positions: [position], workingOrders: [], recentFills: [{ fillId: "outside-fill", orderId: null, symbol: "SPY", side: "sell", quantity: 3, price: 501, filledAt: asOf }], ordersComplete: true, source },
        preparation: { markdown: "Changed after outside fill", revision: "b".repeat(64), date: null, symbol: "SPY", savedAt: asOf },
      })
    }
    const delta = calls === 1 ? { tool_calls: [{ index: 0, id: "fixture-call", type: "function", function: { name: "cairo_read_context", arguments: "{}" } }] } : { content: "fixture done" }
    response.writeHead(200, { "content-type": "text/event-stream" }).end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "probe", choices: [{ index: 0, delta, finish_reason: calls === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve))
  const sidecar = new OpenCodeSidecar({ binary: path.resolve("node_modules/@opencode/cli/bin/opencode.exe"), userDataPath: root, pluginPath, onStatus: () => {}, environment: { CAIRO_TOOL_ENDPOINT: `${base}/copilot/tools`, CAIRO_TOOL_TOKEN: api.toolToken }, config: {
    snapshots: false, model: "cairo-fake/probe", permissions: [{ action: "*", resource: "*", effect: "deny" }, { action: "provider.use", resource: "cairo-fake", effect: "allow" }, { action: "cairo_read", resource: "*", effect: "allow" }, { action: "cairo_propose", resource: "*", effect: "allow" }],
    providers: { "cairo-fake": { package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: "fixture" }, models: { probe: { name: "Fixture", capabilities: { tools: true } } } } },
  } })
  api.setDomainTools(new CairoDomainTools(engine, async id => (await sidecar.client.session.get({ sessionID: id })).location.directory === sidecar.workspace))
  t.after(async () => { await sidecar.stop(); await api.stop(); await new Promise(resolve => provider.close(resolve)); await rm(root, { recursive: true, force: true }) })
  assert.equal(await sidecar.start(), true)
  const session = await sidecar.client.session.create({ title: "Cairo plugin check", location: { directory: sidecar.workspace }, model: { providerID: "cairo-fake", id: "probe" } })
  await sidecar.client.session.prompt({ sessionID: session.id, text: "Fixture" })
  for (let count = 0; calls < 2 && count < 100; count++) await new Promise(resolve => setTimeout(resolve, 100))
  const plugins = await sidecar.client.plugin.list({ location: { directory: sidecar.workspace } })
  assert.ok(plugins.data.some(plugin => plugin.id === "cairo.domain"), JSON.stringify(plugins.data))
  assert.equal(exposed.length, 13)
  assert.ok(exposed.every(name => name.startsWith("cairo_")), JSON.stringify(exposed))
  assert.equal(calls, 2)
  assert.ok(observed[0].includes("CAIRO_CURRENT_CONTEXT"))
  assert.ok(observed[1].includes("Changed after outside fill"))
  assert.ok(observed[1].includes("outside-fill"))
})
