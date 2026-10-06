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
    environment: { CAIRO_TOOL_ENDPOINT: `${base}/copilot/tools`, CAIRO_TOOL_TOKEN: api.toolToken, CAIRO_OPENAI_API_KEY: "fixture-env-key" }, onStatus: () => {} })
  const chat = new CopilotChat({ engine, client: () => sidecar.client, workspace: sidecar.workspace, model: selected.model, fake: true, configured: () => true })
  api.setDomainTools(new CairoDomainTools(engine, async id => (await sidecar.client.session.get({ sessionID: id })).location.directory === sidecar.workspace))
  t.after(async () => { await chat.stop(); await sidecar.stop(); await provider.stop(); await api.stop(); await rm(root, { recursive: true, force: true }) })
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
  assert.ok(!(await readFile(path.join(sidecar.workspace, "opencode.json"), "utf8")).includes("CAIRO_TOOL_TOKEN"))
  assert.ok(!(await readFile(path.join(sidecar.workspace, "opencode.json"), "utf8")).includes("fixture-env-key"))
})
