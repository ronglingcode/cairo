import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { build } from "esbuild"
import { positionEngine, attachmentRequest } from "./fixtures/positions.mjs"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"
import { ExitTickets } from "../src/engine/ExitTickets.mts"
import { TicketPermissions } from "../src/copilot/TicketPermissions.mts"
import { CairoDomainTools } from "../src/copilot/CairoDomainTools.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { OpenCodeSidecar } from "../src/copilot/OpenCodeSidecar.mts"
import { modelConfiguration } from "../src/copilot/ModelConfiguration.mts"
function fixture() {
  const engine = positionEngine(); const guidance = new PositionGuidance(engine); const monitor = new ManagementMonitor(engine, guidance); const attachment = guidance.attach(attachmentRequest(engine))
  monitor.confirm(attachment.id, attachment.revision, 1, "trigger", true)
  const input = { intent: "close", accountId: "fixture", positionId: "position-0", symbol: "AAA", positionSide: "long", factsRevision: 1, quantity: 5, orderType: "market", recommendationId: engine.getSnapshot().recommendations[0].id, reason: "Confirmed partial", commandId: "permission-001" }
  return { engine, input, tickets: new ExitTickets(engine) }
}
const source = { messageID: "msg_fixture", id: "call_fixture", agent: "build" }
test("generic permission allowances/replies never authorize; exact card controls continuation", async () => {
  const f = fixture(); let effect = "allow"; let replies = 0; let sends = 0
  const client = { permission: { create: async () => ({ id: "per_fixture", effect }), reply: async () => { replies++ } } }
  const permissions = new TicketPermissions(f.tickets, () => client)
  await assert.rejects(permissions.stage(f.input, "owned", source), /Generic/); assert.equal(sends, 0)
  effect = "ask"; const waiting = permissions.stage({ ...f.input, commandId: "permission-002" }, "owned", source)
  await new Promise(resolve => setImmediate(resolve)); const ticket = f.engine.getSnapshot().tickets.at(-1)
  await client.permission.reply({ decision: "always" }); assert.equal(ticket.state, "staged"); assert.equal(sends, 0)
  await assert.rejects(permissions.approve(ticket.id, "wrong", async () => sends++))
  await permissions.approve(ticket.id, ticket.reviewHash, async () => { f.tickets.consumeApproval(ticket.id, ticket.reviewHash); sends++; return "synthetic" })
  assert.equal((await waiting).attempt, "synthetic"); assert.equal(sends, 1)
  await assert.rejects(permissions.approve(ticket.id, ticket.reviewHash, async () => sends++))
  const canceled = permissions.stage({ ...f.input, commandId: "permission-003" }, "owned", source); await new Promise(resolve => setImmediate(resolve)); await permissions.cancelSession("owned")
  assert.equal((await canceled).state, "canceled"); assert.equal(sends, 1); assert.ok(replies >= 2)
})
test("actual pinned fake tool loop waits at the exact card and resumes only after explicit review", { timeout: 45_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo-permission-runtime-")); const f = fixture(); const api = new EngineApiServer(f.engine); api.setExitTickets(f.tickets); const base = await api.start()
  let calls = 0
  const provider = createServer(async (request, response) => {
    for await (const _chunk of request) { /* synthetic request consumed; no logging */ }
    calls++
    const delta = calls === 1 ? { tool_calls: [{ index: 0, id: "call_fake", type: "function", function: { name: "cairo_stage_exit", arguments: JSON.stringify(f.input) } }] } : { content: "Exact ticket reviewed" }
    response.writeHead(200, { "content-type": "text/event-stream" }).end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta, finish_reason: calls === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve))
  const selected = modelConfiguration(true, "", `http://127.0.0.1:${provider.address().port}/v1`); const pluginPath = path.join(root, "plugin.js")
  await build({ entryPoints: ["src/copilot/cairo-plugin.mts"], bundle: true, platform: "node", format: "esm", outfile: pluginPath })
  const sidecar = new OpenCodeSidecar({ binary: path.resolve("node_modules/@opencode/cli/bin/opencode.exe"), userDataPath: root, pluginPath, config: selected.config, environment: { CAIRO_TOOL_ENDPOINT: `${base}/copilot/tools`, CAIRO_TOOL_TOKEN: api.toolToken }, onStatus: () => {} })
  const permissions = new TicketPermissions(f.tickets, () => sidecar.client); const domain = new CairoDomainTools(f.engine, async id => (await sidecar.client.session.get({ sessionID: id })).location.directory === sidecar.workspace)
  domain.setExitTickets(f.tickets); domain.setTicketPermissions(permissions); api.setDomainTools(domain); api.setTicketPermissions(permissions)
  t.after(async () => { await permissions.stop(); await sidecar.stop(); await api.stop(); await new Promise(resolve => provider.close(resolve)); await rm(root, { recursive: true, force: true }) })
  assert.equal(await sidecar.start(), true)
  const session = await sidecar.client.session.create({ location: { directory: sidecar.workspace }, model: selected.model })
  await sidecar.client.session.prompt({ sessionID: session.id, text: "Stage the confirmed partial for exact review" })
  let grant
  for (let index = 0; index < 100; index++) { grant = (await sidecar.client.permission.list({ sessionID: session.id }))[0]; if (grant) break; await new Promise(resolve => setTimeout(resolve, 50)) }
  assert.ok(grant); const ticket = f.engine.getSnapshot().tickets.at(-1); assert.deepEqual(grant.resources, [`ticket:${ticket.id}:${ticket.reviewHash}`]); assert.equal(calls, 1)
  const response = await fetch(`${base}/tickets/approve`, { method: "POST", headers: { Authorization: `Bearer ${api.commandToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: ticket.id, expectedHash: ticket.reviewHash }) })
  assert.equal(response.status, 200)
  for (let index = 0; calls < 2 && index < 100; index++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(calls, 2); assert.equal(f.engine.getSnapshot().tickets[0].state, "approved"); assert.equal((await sidecar.client.permission.saved.list({ location: { directory: sidecar.workspace } })).length, 0)
})
