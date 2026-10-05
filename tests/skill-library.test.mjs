import test from "node:test"
import assert from "node:assert/strict"
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import { build } from "esbuild"
import { SkillLibrary } from "../src/copilot/SkillLibrary.mts"
import { skillMentions, skillQuery, completeSkill } from "../src/shared/SkillCommands.mts"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"
import { CopilotChat } from "../src/copilot/CopilotChat.mts"
import { CairoDomainTools } from "../src/copilot/CairoDomainTools.mts"
import { OpenCodeSidecar } from "../src/copilot/OpenCodeSidecar.mts"
import { modelConfiguration } from "../src/copilot/ModelConfiguration.mts"

async function libraryFixture(t, cleanup = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo-skills-"))
  if (cleanup) t.after(() => rm(root, { recursive: true, force: true }))
  await cp("skills", path.join(root, "skills"), { recursive: true })
  return { root, library: new SkillLibrary(path.join(root, "skills")) }
}

test("catalog composes skills once, applies file edits and rejects broken dependencies", async t => {
  const { library } = await libraryFixture(t)
  assert.deepEqual((await library.list()).map(skill => skill.name), ["bookmap-pattern", "manage-trade", "set-stop-loss", "set-targets"])
  const selected = await library.forMessage("/manage-trade /set-stop-loss PCVX")
  assert.deepEqual(selected.map(skill => skill.name), ["set-stop-loss", "set-targets", "manage-trade"])
  const file = selected[0].path
  await writeFile(file, (await readFile(file, "utf8")) + "\nUse the trader's updated wording.\n")
  const edited = await library.forMessage("/set-stop-loss")
  assert.notEqual(edited[0].id, selected[0].id)
  assert.match(edited[0].content, /updated wording/)
  await assert.rejects(library.forMessage("/get-stops"), /Unknown skill/)
  assert.deepEqual(await library.forMessage("https://example.org/foo and C:/tmp/foo"), [])
  const targets = path.join(library.directory, "set-targets", "SKILL.md")
  await writeFile(targets, (await readFile(targets, "utf8")).replace("\n---\n", "\nmetadata:\n  includes: [manage-trade]\n---\n"))
  await assert.rejects(library.load(), /cycle/)
})

test("skill files validate YAML, names, missing dependencies and instruction bounds", async t => {
  const { library } = await libraryFixture(t)
  const file = path.join(library.directory, "set-stop-loss", "SKILL.md")
  const original = await readFile(file, "utf8")
  await writeFile(file, original.replace("name: set-stop-loss", "name: another-name"))
  await assert.rejects(library.load(), /matching name/)
  await writeFile(file, original.replace("\n---\n", "\nmetadata:\n  includes: [missing-skill]\n---\n"))
  await assert.rejects(library.load(), /Unknown skill \/missing-skill/)
  await writeFile(file, original.replace("description:", "description: ["))
  await assert.rejects(library.load(), /invalid YAML/)
  await writeFile(file, "x".repeat(33_000))
  await assert.rejects(library.load(), /under 32 KB/)
  await writeFile(file, original)
  await mkdir(path.join(library.directory, "empty-folder"))
  assert.equal((await library.list()).length, 4)
})

test("slash completion filters prefixes and preserves surrounding text and caret", async () => {
  const library = new SkillLibrary(path.resolve("skills"))
  const query = skillQuery("/s", 2)
  assert.deepEqual((await library.list()).filter(skill => skill.name.startsWith(query.query)).map(skill => skill.name), ["set-stop-loss", "set-targets"])
  assert.deepEqual(completeSkill("/s", query, "set-targets"), { text: "/set-targets ", caret: 13 })
  const text = "Check /set-stop-loss for PCVX"
  const middle = skillQuery(text, 8)
  assert.deepEqual(completeSkill(text, middle, "set-targets"), { text: "Check /set-targets for PCVX", caret: 18 })
  assert.equal(skillQuery("https://test/g", 14), null)
  assert.equal(skillQuery("C:/g", 4), null)
  assert.equal(skillQuery("/set-stop-loss ", 15), null)
  const mentions = skillMentions("/set-stop-loss, then /set-targets PCVX")
  assert.deepEqual(mentions.map(mention => mention.name), ["set-stop-loss", "set-targets"])
  for (const mention of mentions) assert.equal("/set-stop-loss, then /set-targets PCVX".slice(mention.start, mention.end), mention.text)
})

test("authenticated skill catalog refreshes independently of the AI connection", async t => {
  const { library } = await libraryFixture(t)
  const engine = new CairoEngine()
  const api = new EngineApiServer(engine)
  const chat = new CopilotChat({ engine, client: () => undefined, workspace: ".", model: { providerID: "fixture", id: "fixture" }, fake: true, configured: () => true, skills: library })
  api.setCopilotChat(chat)
  const base = await api.start()
  t.after(() => api.stop())
  assert.equal((await fetch(`${base}/copilot/skills`)).status, 403)
  const response = await fetch(`${base}/copilot/skills`, { headers: { Authorization: `Bearer ${api.commandToken}` } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await response.json()
  assert.equal(body.skills.length, 4)
  assert.deepEqual(Object.keys(body.skills[0]).sort(), ["description", "name"])
})

test("pinned OpenCode attaches composed skills, preserves commands and reloads edited instructions", { timeout: 45_000 }, async t => {
  const { root, library } = await libraryFixture(t, false)
  const requests = []
  const provider = createServer(async (request, response) => {
    if (request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return }
    let body = ""
    for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta: { content: "Skill fixture received." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve))
  const engine = new CairoEngine()
  const api = new EngineApiServer(engine)
  const base = await api.start()
  const selected = modelConfiguration(true, "", `http://127.0.0.1:${provider.address().port}/v1`)
  const pluginPath = path.join(root, "plugin.js")
  await build({ entryPoints: ["src/copilot/cairo-plugin.mts"], bundle: true, platform: "node", format: "esm", outfile: pluginPath })
  const sidecar = new OpenCodeSidecar({ binary: path.resolve("node_modules/@opencode/cli/bin/opencode.exe"), userDataPath: root, pluginPath, config: selected.config,
    environment: { CAIRO_TOOL_ENDPOINT: `${base}/copilot/tools`, CAIRO_TOOL_TOKEN: api.toolToken, CAIRO_SKILLS_DIRECTORY: library.directory }, onStatus: () => {} })
  const chat = new CopilotChat({ engine, client: () => sidecar.client, workspace: sidecar.workspace, model: selected.model, fake: true, configured: () => true, skills: library })
  api.setCopilotChat(chat)
  api.setDomainTools(new CairoDomainTools(engine, async id => (await sidecar.client.session.get({ sessionID: id })).location.directory === sidecar.workspace))
  t.after(async () => { await chat.stop(); await sidecar.stop(); await api.stop(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); await rm(root, { recursive: true, force: true }) })
  assert.equal(await sidecar.start(), true)
  await chat.connect()
  await assert.rejects(chat.send("/unknown-skill", "invalid-command-001"), /Unknown skill/)
  assert.equal(chat.snapshot.busy, false)
  assert.equal(requests.length, 0)
  await chat.send("/manage-trade PCVX", "skill-command-001")
  async function done() {
    for (let i = 0; i < 200; i++) { if (!chat.snapshot.busy) return; await new Promise(resolve => setTimeout(resolve, 50)) }
    assert.fail(`Skill reply did not complete: ${JSON.stringify(chat.snapshot)}`)
  }
  await done()
  assert.equal(chat.snapshot.outcome, "succeeded")
  assert.equal(chat.snapshot.messages[0].text, "/manage-trade PCVX")
  assert.equal(requests.length, 1)
  const payload = JSON.stringify(requests[0].messages)
  for (const skill of await library.forMessage("/manage-trade")) assert.ok(payload.includes(skill.content.split("\n")[0]), `Missing ${skill.name} instructions`)
  const context = await sidecar.client.session.context({ sessionID: chat.snapshot.sessionId })
  assert.deepEqual(context.find(message => message.type === "user").metadata.cairoSkills.map(skill => skill.name), ["set-stop-loss", "set-targets", "manage-trade"])
  assert.ok(requests[0].tools.every(tool => tool.function.name.startsWith("cairo_")))
  const file = path.join(library.directory, "set-stop-loss", "SKILL.md")
  await writeFile(file, (await readFile(file, "utf8")) + "\nUPDATED_SKILL_INSTRUCTIONS_MARKER\n")
  await chat.send("/set-stop-loss PCVX", "skill-command-002")
  await done()
  assert.equal(chat.snapshot.outcome, "succeeded")
  assert.equal(requests.length, 2)
  assert.ok(JSON.stringify(requests[1].messages).includes("UPDATED_SKILL_INSTRUCTIONS_MARKER"))
})
