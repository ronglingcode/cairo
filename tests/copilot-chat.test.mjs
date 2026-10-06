import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { CopilotChat } from "../src/copilot/CopilotChat.mts"
import { CairoDomainTools } from "../src/copilot/CairoDomainTools.mts"
import { OpenCodeSidecar } from "../src/copilot/OpenCodeSidecar.mts"
import { FakeModelServer } from "../src/copilot/FakeModelServer.mts"
import { modelConfiguration } from "../src/copilot/ModelConfiguration.mts"
import { build } from "esbuild"
import { BOOKMAP_CARD_ERRORS } from "../src/shared/BookmapCardErrors.mts"
import { SkillLibrary } from "../src/copilot/SkillLibrary.mts"

async function until(predicate) {
  for (let count = 0; count < 150; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  assert.fail("chat condition timed out")
}

function fixture() {
  const engine = new CairoEngine()
  let context = []
  let subscriptions = 0
  let maxSubscriptions = 0
  let prompts = 0
  let loseStream
  const client = {
    session: {
      list: async () => ({ data: [] }), create: async () => ({ id: "owned" }), get: async () => ({ location: { directory: "C:/owned" } }),
      context: async () => structuredClone(context),
      prompt: async input => { prompts++; context.push({ type: "user", id: "user", text: input.text, metadata: input.metadata }) },
      interrupt: async () => { context.push({ type: "idle", id: "idle", outcome: "interrupted" }) },
    },
    event: { subscribe: async function* ({ signal }) {
      subscriptions++; maxSubscriptions = Math.max(maxSubscriptions, subscriptions)
      try { await new Promise(resolve => { loseStream = resolve; signal.addEventListener("abort", resolve, { once: true }); if (signal.aborted) resolve() }) }
      finally { subscriptions-- }
    } },
  }
  const chat = new CopilotChat({ engine, client: () => client, workspace: "C:/owned", model: { providerID: "fixture", id: "model" }, fake: true, configured: () => true })
  return { engine, client, chat, setContext: value => { context = value }, lose: () => loseStream(), prompts: () => prompts, maxSubscriptions: () => maxSubscriptions }
}

test("machine management uses a skill prompt without granting trading approval", async t => {
  const f = fixture(); t.after(() => f.chat.stop())
  let delivered
  const original = f.client.session.prompt
  f.client.session.prompt = async input => { delivered = input; await original(input) }
  await f.chat.connect()
  await f.chat.sendAutomatic("/manage-trade AAA long", "partial-command-001")
  assert.equal(delivered.text, "/manage-trade AAA long")
  assert.equal(delivered.metadata.cairoMachine, true)
  assert.equal(delivered.metadata.grantsApproval, false)
  assert.equal(f.chat.snapshot.busy, true)
})

test("chat cancels, recovers snapshots, and keeps one subscription without resending", async t => {
  const f = fixture()
  t.after(() => f.chat.stop())
  await f.chat.connect()
  assert.equal(f.chat.snapshot.connected, true)
  await f.chat.send("notes", "command-001")
  await assert.rejects(f.chat.send("overlap", "command-002"), /wait/)
  await f.chat.send("notes", "command-001")
  assert.equal(f.prompts(), 1)
  await assert.rejects(f.chat.send("changed", "command-001"), /another payload/)
  await f.chat.cancel()
  assert.equal(f.chat.snapshot.outcome, "interrupted")
  assert.equal(f.chat.snapshot.busy, false)
  f.lose()
  await until(() => !f.chat.snapshot.connected)
  f.setContext([{ type: "user", id: "user", text: "notes" }, { type: "assistant", id: "answer", content: [{ type: "text", text: "Recovered answer" }, { type: "tool", name: "cairo_read_context", state: { status: "completed" } }] }, { type: "idle", outcome: "succeeded" }])
  await f.chat.connect()
  await f.chat.connect()
  assert.equal(f.chat.snapshot.messages[1].text, "Recovered answer")
  assert.equal(f.chat.snapshot.messages[1].tools[0].state, "completed")
  assert.equal(f.prompts(), 1)
  assert.equal(f.maxSubscriptions(), 1)
})

test("uncertain delivery blocks new sends until session inspection; chat API requires renderer capability", async t => {
  const f = fixture()
  const api = new EngineApiServer(f.engine)
  api.setCopilotChat(f.chat)
  const base = await api.start()
  t.after(async () => { await f.chat.stop(); await api.stop() })
  await f.chat.connect()
  f.client.session.prompt = async () => { throw new Error("secret-provider-detail") }
  await assert.rejects(f.chat.send("uncertain", "command-003"), /uncertain/)
  assert.equal(f.chat.snapshot.connected, false)
  assert.ok(!JSON.stringify(f.chat.snapshot).includes("secret-provider-detail"))
  await assert.rejects(f.chat.send("retry", "command-004"), /Reconnect/)
  assert.equal((await fetch(`${base}/copilot/send`, { method: "POST", headers: { Authorization: `Bearer ${api.toolToken}` } })).status, 403)
  assert.equal(f.engine.getSnapshot().tickets.length, 0)
})

test("acknowledged cancellation stays idle when context still reports a streaming tool", async t => {
  const f = fixture()
  t.after(() => f.chat.stop())
  await f.chat.connect()
  await f.chat.send("first", "cancel-stale-001")
  f.setContext([{ type: "assistant", id: "stale", content: [{ type: "tool", name: "cairo_interpret_bookmap_observation", state: { status: "streaming" } }] }])
  f.client.session.interrupt = async () => {}
  await f.chat.cancel()
  assert.equal(f.chat.snapshot.busy, false)
  assert.equal(f.chat.snapshot.outcome, "interrupted")
  assert.equal(f.chat.snapshot.messages[0].tools[0].state, "canceled")
  await f.chat.connect()
  assert.equal(f.chat.snapshot.busy, false, "reconnect must not restore canceled busy state")
  await f.chat.send("on demand", "cancel-stale-002")
  assert.equal(f.prompts(), 2)
  assert.equal(f.chat.snapshot.busy, true)
})

test("automatic and on-demand chats use independent sessions, histories, and cancellation", async t => {
  const engine = new CairoEngine()
  const sessions = new Map()
  const interrupts = []
  const client = {
    session: {
      list: async () => ({ data: [...sessions.values()] }),
      create: async input => {
        const session = { ...input, id: input.metadata.cairoChannel, context: [] }
        sessions.set(session.id, session)
        return session
      },
      get: async ({ sessionID }) => sessions.get(sessionID),
      context: async ({ sessionID }) => structuredClone(sessions.get(sessionID).context),
      synthetic: async ({ sessionID, text, id }) => { sessions.get(sessionID).context.push({ type: "synthetic", id }, { type: "assistant", id: "auto-answer", content: [{ type: "text", text }] }) },
      prompt: async ({ sessionID, text, metadata }) => { sessions.get(sessionID).context.push({ type: "user", id: "human-question", text, metadata }) },
      interrupt: async ({ sessionID }) => { interrupts.push(sessionID) },
    },
    event: { subscribe: async function* ({ signal }) { await new Promise(resolve => { signal.addEventListener("abort", resolve, { once: true }); if (signal.aborted) resolve() }) } },
  }
  const options = { engine, client: () => client, workspace: "C:/owned", model: { providerID: "fixture", id: "model" }, fake: true, configured: () => true }
  const foreground = new CopilotChat(options)
  const automatic = new CopilotChat({ ...options, channel: "automatic" })
  const api = new EngineApiServer(engine)
  api.setCopilotChat(foreground)
  api.setCopilotAutomaticChat(automatic)
  const base = await api.start()
  t.after(async () => { await Promise.all([foreground.stop(), automatic.stop()]); await api.stop() })
  await Promise.all([foreground.connect(), automatic.connect()])
  assert.notEqual(foreground.snapshot.sessionId, automatic.snapshot.sessionId)
  await automatic.notify("Automatic observation", "automatic-fixture")
  assert.equal(automatic.snapshot.busy, true)
  assert.equal(foreground.snapshot.busy, false)
  const post = (route, body) => fetch(`${base}${route}`, { method: "POST", headers: { Authorization: `Bearer ${api.commandToken}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
  assert.equal((await post("/copilot/send", { text: "My question", commandId: "human-question-001" })).status, 200)
  assert.equal(foreground.snapshot.busy, true)
  assert.equal(automatic.snapshot.busy, true)
  assert.equal(engine.getSnapshot().copilotChat.messages[0].text, "My question")
  assert.equal(engine.getSnapshot().copilotAutomaticChat.messages[0].text, "Automatic observation")
  assert.equal((await post("/copilot/cancel")).status, 200)
  assert.equal(automatic.snapshot.busy, true)
  assert.deepEqual(interrupts, ["foreground"])
  assert.equal((await post("/copilot/automatic/cancel")).status, 200)
  assert.deepEqual(interrupts, ["foreground", "automatic"])
  assert.equal(automatic.snapshot.busy, false)
  await Promise.all([foreground.connect(), automatic.connect()])
  assert.equal(sessions.size, 2, "reconnect reuses each channel's own session")
})

test("chat exposes only safe Bookmap card validation details",async t=>{
  const f=fixture();t.after(()=>f.chat.stop())
  f.setContext([{type:"assistant",id:"card-errors",content:[
    {type:"tool",name:"cairo_interpret_bookmap_observation",state:{status:"error",error:{type:"unknown",message:BOOKMAP_CARD_ERRORS['unmeasured-price']}}},
    {type:"tool",name:"cairo_interpret_bookmap_observation",state:{status:"error",error:{type:"unknown",message:"private-provider-detail"}}},
  ]},{type:"idle",outcome:"succeeded"}])
  await f.chat.connect()
  assert.equal(f.chat.snapshot.messages[0].tools[0].error,BOOKMAP_CARD_ERRORS['unmeasured-price'])
  assert.equal(f.chat.snapshot.messages[0].tools[1].error,undefined)
  assert.ok(!JSON.stringify(f.chat.snapshot).includes('private-provider-detail'))
})

test("actual pinned runtime streams, cancels, and reuses a Cairo session after restart", { timeout: 45_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "Cairo chat "))
  const engine = new CairoEngine()
  const api = new EngineApiServer(engine)
  const base = await api.start()
  const provider = new FakeModelServer("fixture-env-key")
  const selected = modelConfiguration(true, "", await provider.start())
  selected.config.providers["cairo-model"].settings.apiKey = "{env:CAIRO_OPENAI_API_KEY}"
  const pluginPath = path.join(root, "plugin.js")
  await build({ entryPoints: ["src/copilot/cairo-plugin.mts"], bundle: true, platform: "node", format: "esm", outfile: pluginPath })
  const sidecar = new OpenCodeSidecar({ binary: path.resolve("node_modules/@opencode/cli/bin/opencode.exe"), userDataPath: root, pluginPath, config: selected.config,
    environment: { CAIRO_TOOL_ENDPOINT: `${base}/copilot/tools`, CAIRO_TOOL_TOKEN: api.toolToken, CAIRO_OPENAI_API_KEY: "fixture-env-key", CAIRO_SKILLS_DIRECTORY: path.resolve("skills") }, onStatus: () => {} })
  const chat = new CopilotChat({ engine, client: () => sidecar.client, workspace: sidecar.workspace, model: selected.model, fake: true, configured: () => true })
  const automatic = new CopilotChat({ engine, client: () => sidecar.client, workspace: sidecar.workspace, model: selected.model, fake: true, configured: () => true, channel: "automatic", skills: new SkillLibrary(path.resolve("skills")) })
  api.setDomainTools(new CairoDomainTools(engine, async id => (await sidecar.client.session.get({ sessionID: id })).location.directory === sidecar.workspace))
  t.after(async () => { await Promise.all([chat.stop(), automatic.stop()]); await sidecar.stop(); await provider.stop(); await api.stop(); await rm(root, { recursive: true, force: true }) })
  assert.equal(await sidecar.start(), true)
  await chat.connect()
  const id = chat.snapshot.sessionId
  await chat.send("Discuss my preparation", "actual-command-001")
  await until(() => chat.snapshot.messages.some(message => message.role === "assistant" && message.text.length > 0) && chat.snapshot.busy)
  await chat.cancel()
  await until(() => !chat.snapshot.busy)
  assert.equal(chat.snapshot.outcome, "interrupted")
  await chat.send("Discuss the one-minute chart", "actual-command-002")
  await until(() => !chat.snapshot.busy && chat.snapshot.outcome === "succeeded")
  assert.ok(chat.snapshot.messages.some(message => message.text.includes("Local fake model")))
  await chat.notify("Machine observation only. Assess the latest account change; no trading approval.", "synthetic-fixture-001")
  await until(() => !chat.snapshot.busy && chat.snapshot.outcome === "succeeded")
  await chat.stop()
  await sidecar.restart()
  await chat.connect()
  assert.equal(chat.snapshot.sessionId, id)
  assert.equal(chat.snapshot.messages.filter(message => message.role === "user").length, 2)
  const reopened = new CopilotChat({ engine, client: () => sidecar.client, workspace: sidecar.workspace, model: selected.model, fake: true, configured: () => true })
  await chat.stop()
  await reopened.connect()
  assert.equal(reopened.snapshot.sessionId, id)
  await reopened.stop()
  await Promise.all([chat.connect(), automatic.connect()])
  assert.notEqual(chat.snapshot.sessionId, automatic.snapshot.sessionId)
  await automatic.notify("Machine observation only; review chart context.", "parallel-fixture-001")
  await chat.send("My on-demand question while automatic analysis runs", "parallel-human-001")
  assert.equal(chat.snapshot.busy, true)
  assert.equal(automatic.snapshot.busy, true)
  await chat.cancel()
  assert.equal(chat.snapshot.busy, false)
  await until(() => !automatic.snapshot.busy && automatic.snapshot.outcome === "succeeded")
  assert.ok(!chat.snapshot.messages.some(message => message.text.includes("Machine observation only; review chart context.")))
  assert.ok(!automatic.snapshot.messages.some(message => message.text.includes("My on-demand question")))
  await automatic.sendAutomatic("/manage-trade AAA long", "partial-runtime-001")
  await until(() => !automatic.snapshot.busy && automatic.snapshot.outcome === "succeeded")
  const managementContext = await sidecar.client.session.context({ sessionID: automatic.snapshot.sessionId })
  const managementPrompt = managementContext.find(message => message.type === "user" && message.metadata?.cairoCommand === "partial-runtime-001")
  assert.equal(managementPrompt.metadata.cairoMachine, true)
  assert.equal(managementPrompt.metadata.grantsApproval, false)
  assert.deepEqual(managementPrompt.metadata.cairoSkills.map(skill => skill.name), ["trade-context", "set-stop-loss", "set-targets", "manage-trade"])
  assert.ok(!(await readFile(path.join(sidecar.workspace, "opencode.json"), "utf8")).includes("CAIRO_TOOL_TOKEN"))
  assert.ok(!(await readFile(path.join(sidecar.workspace, "opencode.json"), "utf8")).includes("fixture-env-key"))
})
