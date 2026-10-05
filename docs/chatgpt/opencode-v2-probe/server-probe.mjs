import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { OpenCode } from "@opencode/client"

const directory = path.dirname(fileURLToPath(import.meta.url))
const binary = path.join(directory, "node_modules/@opencode/cli/bin/opencode.exe")
const manual = process.argv.includes("--manual")
assert.equal(process.platform, "win32", "this probe verifies the Windows runtime")
const runDirectory = await mkdtemp(path.join(os.tmpdir(), "cairo-opencode-probe-"))
const workspace = path.join(runDirectory, "workspace")
const pluginFile = path.join(workspace, ".opencode/plugins/cairo-probe.js")
await mkdir(path.dirname(pluginFile), { recursive: true })
const bundle = await build({ entryPoints: [path.join(directory, ".opencode/plugins/cairo-probe.ts")], bundle: true, format: "esm", platform: "node", outfile: pluginFile, metafile: true })
assert.ok(Object.values(bundle.metafile.outputs).every((output) => output.imports.length === 0), "runtime plugin must be self-contained")
const bundled = await readFile(pluginFile, "utf8")
assert.ok(!bundled.includes('from "@opencode/'), "runtime plugin must not depend on a global package installation")

// Preserve Windows process essentials, exclude inherited provider keys and OpenCode settings.
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|windir|PATH|PATHEXT|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)))
const windowsDirectory = process.env.SystemRoot ?? process.env.SYSTEMROOT
assert.ok(windowsDirectory)
for (const key of Object.keys(environment).filter((key) => /^path$/i.test(key))) delete environment[key]
environment.PATH = `${windowsDirectory}\\System32;${windowsDirectory}`
for (const [name, subpath] of Object.entries({ XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data", XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state" })) {
  environment[name] = path.join(runDirectory, subpath)
  await mkdir(environment[name], { recursive: true })
}
environment.OPENCODE_SERVER_PASSWORD = randomBytes(24).toString("hex")
environment.OPENCODE_CONFIG_DIR = path.join(runDirectory, "config/opencode")
await mkdir(environment.OPENCODE_CONFIG_DIR, { recursive: true })
const paths = spawnSync(binary, ["debug", "paths"], { cwd: workspace, env: environment, windowsHide: true, encoding: "utf8", timeout: 15000 })
assert.equal(paths.status, 0, "pinned Windows binary must run")
const ownedPaths = paths.stdout.split(/\r?\n/).filter((value) => /^(data|cache|config|state)\s/.test(value))
assert.equal(ownedPaths.length, 4)
for (const line of ownedPaths) {
  assert.ok(line.includes(runDirectory), `runtime path must be isolated: ${line}`)
}

let providerFailure
let providerCalls = 0
const exposedTools = new Set()
const observedReplies = new Map()
const eventAbort = new AbortController()
let eventTask
const provider = createServer(async (request, response) => {
  try {
    let body = ""
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    if (request.url === "/cairo/approve") {
      assert.equal(input.sessionID, sessionID)
      const grant = await client.permission.create({ sessionID, action: "cairo_trade", resources: ["fixture-exit"], save: ["fixture-exit"], agent: "build", source: { type: "tool", messageID: input.messageID, id: input.id } })
      assert.equal(grant.effect, "ask", "the mock backend requires a new explicit approval")
      const reply = await until("matching live permission.replied event", () => observedReplies.get(grant.id), manual ? 120000 : 30000)
      observedReplies.delete(grant.id)
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ approved: reply === "once" }))
      return
    }
    assert.equal(request.url, "/v1/chat/completions")
    const tools = input.tools ?? []
    for (const tool of tools) exposedTools.add(tool.function.name)
    let name
    let text = "Cairo fixture probe"
    if (tools.length) {
      assert.ok(++providerCalls <= 8, "bounded fake provider: unexpected tool continuation loop")
      const messages = input.messages ?? []
      const lastUser = messages.findLastIndex((item) => item.role === "user")
      const current = messages.slice(lastUser)
      const userText = JSON.stringify(current[0]?.content)
      name = userText.includes("CAIRO_PROBE_READ") ? "cairo_read_fixture" : "cairo_request_exit"
      assert.ok(exposedTools.has(name), `OpenCode did not expose ${name} as a direct tool`)
      if (current.some((item) => item.role === "tool")) {
        name = undefined
        text = "CAIRO_PROBE_DONE"
      }
    }
    const toolCalls = name ? [{ id: `call_probe_${providerCalls}`, type: "function", function: { name, arguments: "{}" } }] : []
    if (input.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.end(`data: ${JSON.stringify({ id: "chatcmpl-probe", object: "chat.completion.chunk", created: 0, model: "probe", choices: [{ index: 0, delta: name ? { tool_calls: toolCalls.map((call, index) => ({ ...call, index })) } : { content: text }, finish_reason: name ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`)
    } else {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ id: "chatcmpl-probe", object: "chat.completion", created: 0, model: "probe", choices: [{ index: 0, message: { role: "assistant", content: name ? null : text, tool_calls: toolCalls }, finish_reason: name ? "tool_calls" : "stop" }] }))
    }
  } catch (error) {
    providerFailure = error
    response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: error.message, type: "probe_failed" } }))
  }
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
environment.CAIRO_PROBE_APPROVAL_URL = `http://127.0.0.1:${provider.address().port}/cairo/approve`
const config = JSON.parse(await readFile(path.join(directory, "opencode.json"), "utf8"))
config.snapshots = false
config.permissions.push({ action: "provider.use", resource: "cairo-fake", effect: "allow" })
config.model = "cairo-fake/probe"
config.providers = { "cairo-fake": { package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: "fixture-only" }, models: { probe: { name: "Fake local fixture", capabilities: { tools: true } } } } }
await writeFile(path.join(workspace, "opencode.json"), JSON.stringify(config, null, 2))

let server
let serverOutput = ""
let terminal
let client
let sessionID
const shutdown = new AbortController()
const interrupt = () => {
  providerFailure = new Error("Probe interrupted")
  shutdown.abort()
}
process.on("SIGINT", interrupt)
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
async function until(description, check, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (providerFailure) throw providerFailure
    const result = await check()
    if (result) return result
    await delay(150)
  }
  throw new Error(`Timed out: ${description}`)
}
async function context() {
  return client.session.context({ sessionID })
}
function toolParts(messages) {
  return messages.flatMap((message) => message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [])
}
async function completedPrompt(marker) {
  return until("model continuation completed", async () => {
    const messages = await context()
    const last = messages.at(-1)
    if (last?.type === "assistant" && last.error) throw new Error(JSON.stringify(last.error))
    const latestUser = messages.findLast((message) => message.type === "user")
    if (last?.type === "idle" && last.outcome !== "succeeded") throw new Error(`Session ended with ${last.outcome}`)
    return latestUser?.text === marker && last?.type === "idle" && last.outcome === "succeeded" ? messages : undefined
  })
}

try {
  server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: workspace, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  server.stdout.on("data", (chunk) => { serverOutput += chunk })
  server.stderr.on("data", (chunk) => { serverOutput += chunk })
  const baseUrl = await until("headless server startup", () => {
    if (server.exitCode !== null) throw new Error(`OpenCode exited during startup (${server.exitCode})`)
    return serverOutput.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
  })
  client = OpenCode.make({ baseUrl, headers: { Authorization: `Basic ${Buffer.from(`opencode:${environment.OPENCODE_SERVER_PASSWORD}`).toString("base64")}` } })
  const serverInfo = await client.server.info()
  assert.equal(serverInfo.version, "2.0.22")
  assert.equal(serverInfo.pid, server.pid, "probe must connect to its own server")
  eventTask = (async () => {
    try {
      for await (const event of client.event.subscribe({ signal: eventAbort.signal })) {
        if (event.type === "permission.replied" && event.data.sessionID === sessionID) {
          observedReplies.set(event.data.requestID, event.data.reply)
        }
      }
    } catch (error) {
      if (!eventAbort.signal.aborted) providerFailure = error
    }
  })()
  console.log("PASS: pinned OpenCode 2.0.22 Windows server; isolated config and storage; no global Node/Bun on child PATH")
  const session = await client.session.create({ title: "Cairo fixture verification", location: { directory: workspace }, model: { providerID: "cairo-fake", id: "probe" } })
  sessionID = session.id
  await client.session.prompt({ sessionID, text: "CAIRO_PROBE_READ" })
  const readMessages = await completedPrompt("CAIRO_PROBE_READ")
  const readResult = toolParts(readMessages).find((part) => part.name === "cairo_read_fixture")
  assert.equal(readResult?.state.status, "completed", JSON.stringify(readResult))
  assert.ok(JSON.stringify(readResult.state).includes("cairo-fake-read-ok"))
  console.log("PASS: model -> OpenCode -> bundled Cairo plugin -> cairo-fake-read-ok")

  if (manual) terminal = createInterface({ input: process.stdin, output: process.stdout })
  let previousRequestID
  for (const attempt of [1, 2]) {
    const before = toolParts(await context()).filter((part) => part.name === "cairo_request_exit" && part.state.status === "completed").length
    await client.session.prompt({ sessionID, text: `CAIRO_PROBE_ACTION_${attempt}` })
    const permission = await until("real OpenCode permission prompt", async () => (await client.permission.list({ sessionID }))[0])
    assert.notEqual(permission.id, previousRequestID)
    previousRequestID = permission.id
    assert.equal(permission.action, "cairo_trade")
    assert.deepEqual(permission.resources, ["fixture-exit"])
    const pendingAction = toolParts(await context()).findLast((part) => part.name === "cairo_request_exit")
    assert.equal(pendingAction?.state.status, "running")
    assert.equal(permission.source?.id, pendingAction.id)
    assert.equal(toolParts(await context()).filter((part) => part.name === "cairo_request_exit" && part.state.status === "completed").length, before)
    console.log(`PASS: fake action ${attempt} is blocked on a new permission request`)
    const decision = attempt === 1 ? "once" : "reject"
    if (terminal) {
      const answer = await terminal.question(attempt === 1 ? "Approve this fake action once? Type once: " : "A second approval is required. Reject this fake action? Type reject: ", { signal: shutdown.signal })
      assert.equal(answer.trim(), decision)
    }
    await client.permission.reply({ sessionID, requestID: permission.id, decision })
    const after = toolParts(await completedPrompt(`CAIRO_PROBE_ACTION_${attempt}`)).filter((part) => part.name === "cairo_request_exit")
    if (attempt === 1) {
      assert.ok(JSON.stringify(after).includes("permission-granted-once"))
      console.log("PASS: decision=once allowed exactly the pending fake action")
    } else {
      assert.equal(after.filter((part) => part.state.status === "completed").length, before)
      assert.equal(after.at(-1).state.status, "error")
      console.log("PASS: previous one-time approval did not authorize action 2; rejection prevented execution")
    }
    assert.equal((await client.permission.saved.list({ location: { directory: workspace } })).length, 0)
  }
  console.log(`PASS: ${providerCalls} bounded local fixture model requests; no saved permissions`)
} finally {
  terminal?.close()
  eventAbort.abort()
  await eventTask
  try {
    if (client && sessionID) {
      await writeFile(path.join(runDirectory, "context.json"), JSON.stringify(await context(), null, 2))
      await writeFile(path.join(runDirectory, "permissions.json"), JSON.stringify(await client.permission.list({ sessionID }), null, 2))
    }
  } catch {
    console.log("Could not capture final API diagnostics; stopping the owned server")
  }
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve))
    server.kill()
    await exited
  }
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(path.join(runDirectory, "server-output.log"), serverOutput.replaceAll(environment.OPENCODE_SERVER_PASSWORD, "[probe password]"))
  console.log(`Probe artifacts: ${runDirectory}`)
  console.log(`Local provider calls: ${providerCalls}; exposed Cairo tools: ${[...exposedTools].filter((name) => name.startsWith("cairo_")).join(", ")}`)
  if (server) console.log("PASS: owned headless server stopped")
  process.removeListener("SIGINT", interrupt)
}
console.log("ALL CHECKS PASSED")
