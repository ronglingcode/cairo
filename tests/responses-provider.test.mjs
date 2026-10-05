import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import { build } from "esbuild"
import { modelConfiguration } from "../src/copilot/ModelConfiguration.mts"
import { OpenCodeSidecar } from "../src/copilot/OpenCodeSidecar.mts"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { CairoDomainTools } from "../src/copilot/CairoDomainTools.mts"
import { CopilotChat } from "../src/copilot/CopilotChat.mts"

test("pinned Responses provider streams a tool round trip into Cairo chat", { timeout: 45_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "Cairo responses "))
  const engine = new CairoEngine()
  const api = new EngineApiServer(engine)
  const base = await api.start()
  const inputs = []
  const provider = createServer(async (request, response) => {
    assert.equal(request.url, "/v1/responses")
    assert.equal(request.headers.authorization, "Bearer fixture-key")
    let raw = ""
    for await (const chunk of request) raw += chunk
    const input = JSON.parse(raw)
    inputs.push(input)
    const toolCall = inputs.length === 1
    const item = toolCall
      ? { id: "fc_fixture", type: "function_call", call_id: "call_fixture", name: "cairo_read_context", arguments: "{}", status: "completed" }
      : { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Responses fixture complete", annotations: [] }] }
    const result = { id: `resp_${inputs.length}`, object: "response", created_at: 0, model: input.model, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }
    response.writeHead(200, { "content-type": "text/event-stream" })
    const event = value => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`)
    event({ type: "response.created", response: { ...result, status: "in_progress", output: [] } })
    event({ type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", ...(toolCall ? { arguments: "" } : { content: [] }) } })
    if (toolCall) {
      event({ type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: "{}" })
      event({ type: "response.function_call_arguments.done", item_id: item.id, output_index: 0, arguments: "{}" })
    } else {
      event({ type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } })
      event({ type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "Responses fixture complete" })
      event({ type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text: "Responses fixture complete" })
    }
    event({ type: "response.output_item.done", output_index: 0, item })
    event({ type: "response.completed", response: result })
    response.end()
  })
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve))
  const selected = modelConfiguration(false, "gpt-6.1-sol", "")
  selected.config.providers["cairo-model"].settings.baseURL = `http://127.0.0.1:${provider.address().port}/v1`
  const pluginPath = path.join(root, "plugin.js")
  await build({ entryPoints: ["src/copilot/cairo-plugin.mts"], bundle: true, platform: "node", format: "esm", outfile: pluginPath })
  const sidecar = new OpenCodeSidecar({ binary: path.resolve("node_modules/@opencode/cli/bin/opencode.exe"), userDataPath: root, pluginPath,
    config: selected.config, environment: { CAIRO_OPENAI_API_KEY: "fixture-key", CAIRO_TOOL_ENDPOINT: `${base}/copilot/tools`, CAIRO_TOOL_TOKEN: api.toolToken }, onStatus: () => {} })
  const chat = new CopilotChat({ engine, client: () => sidecar.client, workspace: sidecar.workspace, model: selected.model, fake: false, configured: () => true })
  api.setDomainTools(new CairoDomainTools(engine, async id => (await sidecar.client.session.get({ sessionID: id })).location.directory === sidecar.workspace))
  t.after(async () => { await chat.stop(); await sidecar.stop(); await api.stop(); await new Promise(resolve => provider.close(resolve)); await rm(root, { recursive: true, force: true }) })
  assert.equal(await sidecar.start(), true)
  await chat.connect()
  await chat.send("Read the context and reply", "responses-fixture-1")
  for (let i = 0; i < 200 && (inputs.length < 2 || chat.snapshot.busy); i++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(inputs.length, 2)
  assert.equal(inputs[0].model, "gpt-6.1-sol")
  assert.ok(inputs[0].tools.some(tool => tool.name === "cairo_read_context"))
  assert.ok(JSON.stringify(inputs[1].input).includes("function_call_output"))
  assert.ok(chat.snapshot.messages.some(message => message.role === "assistant" && message.text.includes("Responses fixture complete")))
})
