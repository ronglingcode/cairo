// Run after npm run build: node_modules/.bin/electron scripts/verify-chat-window.cjs
// Uses a disposable fake profile; no broker credentials or account are configured.
const { app, BrowserWindow } = require("electron")
process.on("uncaughtException", error => { console.error(error); app.exit(1) })
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const root = path.resolve(__dirname, "..")
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cairo-chat-window-"))
process.env.CAIRO_USER_DATA = profile
process.env.CAIRO_WINDOW_TEST_MODE = "hidden"
process.env.CAIRO_TRADEBOOK_PATH = profile
fs.writeFileSync(path.join(profile, "activeTradebooks.md"), "# Active tradebooks\n")
fs.writeFileSync(path.join(profile, "config.json"), JSON.stringify({
  provider: "fake", selectedAccountId: "", secretsFile: "", workspace_root_path: profile,
  schwabTokenFile: path.join(profile, "no-broker-tokens.json"),
  bookmapEndpoint: "ws://127.0.0.1:1",
}))
app.setAppPath(root)
const shownWindows = []
app.on("browser-window-created", (_event, window) => {
  window.on("show", () => shownWindows.push(window.id))
})
require(path.join(root, "dist-electron/main.js"))
const pause = () => new Promise(resolve => setTimeout(resolve, 50))
async function until(check) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { if (await check()) return; await pause() }
  throw new Error("Timed out waiting for Cairo UI")
}
async function ready(window) {
  await until(async () => !window.webContents.isLoading() && await window.webContents.executeJavaScript('Boolean(document.querySelector(".composer-wrap"))').catch(() => false))
}
const evaluate = (window, code) => window.webContents.executeJavaScript(code)
const typeDraft = (window, text) => evaluate(window, `(() => {
  const textarea = document.querySelector('#cairo-message')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, ${JSON.stringify(text)})
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
const watchdog = setTimeout(() => { console.error("Chat window verification timed out"); app.exit(1) }, 45000)
let exitCode = 0
app.once("will-quit", () => { if (exitCode) app.exit(exitCode) })
app.once("quit", () => {
  clearTimeout(watchdog)
  assert.equal(path.dirname(profile), os.tmpdir())
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
  catch (error) {
    // Windows can retain Chromium's profile lock until this process has exited.
    if (!["EPERM", "EBUSY"].includes(error.code)) throw error
    console.warn(`Verification complete; temporary profile still locked: ${profile}`)
  }
})
;(async () => {
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows().length === 1)
  const main = BrowserWindow.getAllWindows()[0]
  await ready(main)
  assert.equal(main.isVisible(), false, "Verification must not open a visible app window")
  await typeDraft(main, "preserved trading question")
  await until(async () => await evaluate(main, 'window.cairo.chatDraft()') === "preserved trading question")
  assert.equal(await evaluate(main, 'document.querySelectorAll(".chat-history").length'), 1)
  assert.equal(await evaluate(main, 'document.querySelectorAll(".composer-wrap").length'), 1)
  assert.equal(await evaluate(main, 'Boolean(document.querySelector(".chat-tabs"))'), false)
  assert.equal(await evaluate(main, 'document.querySelector("#cairo-message").value'), "preserved trading question")
  const runtime = await evaluate(main, 'fetch(`${window.cairo.apiBaseUrl}/snapshot`).then(r => r.json()).then(s => s.runtimeInstanceId)')
  await evaluate(main, 'window.cairo.chatWindow("detach")')
  const chat = BrowserWindow.getAllWindows().find(window => window !== main)
  assert.ok(chat)
  await ready(chat)
  assert.equal(chat.isVisible(), false, "Pop-out verification must stay hidden")
  // Settings persist a new document root while retaining the active root until restart.
  const documentRoot = path.join(profile, "human documents")
  fs.mkdirSync(documentRoot)
  const derived = await evaluate(main, `window.cairo.documentSettings("derive", ${JSON.stringify(profile)})`)
  assert.equal(derived.tradebooks_root_path, path.join(profile, "Backtest", "tradebooks"))
  assert.equal(derived.secretsFile, path.join(profile, "secrets", "storeSecrets.js"))
  const fakeSecrets = path.join(profile, "fake-storeSecrets.js")
  fs.writeFileSync(fakeSecrets, 'localStorage.setItem("cairo.openai", JSON.stringify({apiKey: "synthetic-qa-key"}));')
  await evaluate(main, 'document.querySelectorAll(".view-switch button")[2].click()')
  await until(async () => await evaluate(main, 'Boolean(document.querySelector("#tradebooks-root-path"))'))
  await assert.rejects(evaluate(main, 'window.cairo.documentSettings("save", "relative/path")'), /absolute path/)
  await assert.rejects(evaluate(main, `window.cairo.documentSettings("save", ${JSON.stringify(path.join(profile, "missing"))})`), /existing folder/)
  const settings = await evaluate(main, `window.cairo.documentSettings("save", ${JSON.stringify(documentRoot)})`)
  assert.equal(settings.config.tradebooks_root_path, documentRoot)
  assert.equal(settings.activeRoot, profile)
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, "config.json"), "utf8")).tradebooks_root_path, documentRoot)
  await until(async () => await evaluate(main, 'document.querySelector("#tradebooks-root-path").value') === documentRoot)
  assert.equal(await evaluate(main, 'document.querySelector(".settings-card").innerText.includes("Restart Cairo")'), true)
  const secretSettings = await evaluate(main, `window.cairo.documentSettings("save", ${JSON.stringify({ workspace_root_path: profile, tradebooks_root_path: documentRoot, secretsFile: fakeSecrets })})`)
  assert.equal(secretSettings.config.secretsFile, fakeSecrets)
  assert.equal(secretSettings.activeSecretsFile, "", "Saved credentials only apply after restart")
  assert.equal(JSON.stringify(secretSettings).includes("synthetic-qa-key"), false)
  if (process.env.CAIRO_SETTINGS_SCREENSHOT) {
    await new Promise(resolve => setTimeout(resolve, 300))
    fs.writeFileSync(process.env.CAIRO_SETTINGS_SCREENSHOT, (await main.webContents.capturePage()).toPNG())
  }
  await evaluate(main, 'document.querySelectorAll(".view-switch button")[0].click()')
  await until(async () => await evaluate(chat, 'document.querySelector("#cairo-message").value') === "preserved trading question")
  assert.equal(await evaluate(chat, 'window.cairo.view'), "chat")
  assert.equal(await evaluate(chat, 'fetch(`${window.cairo.apiBaseUrl}/snapshot`).then(r => r.json()).then(s => s.runtimeInstanceId)'), runtime)
  await evaluate(main, 'window.cairo.chatWindow("detach")')
  assert.equal(BrowserWindow.getAllWindows().length, 2, "Repeated pop-out focuses the existing chat")
  await typeDraft(chat, "updated from detached chat")
  await until(async () => await evaluate(main, 'document.querySelector("#cairo-message").value') === "updated from detached chat")
  chat.setSize(420, 540)
  await pause()
  const bounds = await evaluate(chat, `(() => {
    const history = document.querySelector('.chat-history').getBoundingClientRect()
    const composer = document.querySelector('.composer-wrap').getBoundingClientRect()
    return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, historyHeight: history.height, bottom: composer.bottom, height: innerHeight }
  })()`)
  if (bounds.historyHeight <= 60 && process.env.CAIRO_QA_SCREENSHOT) {
    console.log("Narrow chat bounds:", bounds)
    fs.writeFileSync(process.env.CAIRO_QA_SCREENSHOT, (await chat.webContents.capturePage()).toPNG())
  }
  assert.equal(bounds.overflow, false, "Narrow pop-out has no horizontal overflow")
  assert.ok(bounds.historyHeight > 60, "Conversation retains usable height")
  assert.ok(bounds.bottom <= bounds.height, "Composer remains visible")
  chat.setSize(720, 860)
  await pause()
  if (process.env.CAIRO_QA_SCREENSHOT) {
    fs.writeFileSync(process.env.CAIRO_QA_SCREENSHOT, (await chat.webContents.capturePage()).toPNG())
    console.log(`Live chat screenshot: ${process.env.CAIRO_QA_SCREENSHOT}`)
  }
  chat.close()
  await until(async () => await evaluate(main, 'document.querySelector(".copilot-column").hidden') === false)
  await evaluate(main, 'document.querySelectorAll(".view-switch button")[1].click()')
  await until(async () => await evaluate(main, 'document.querySelector(".main-column").hidden') === true)
  await evaluate(main, 'window.cairo.chatWindow("detach")')
  const secondChat = BrowserWindow.getAllWindows().find(window => window !== main)
  await ready(secondChat)
  await evaluate(secondChat, 'void window.cairo.chatWindow("dock")')
  await until(() => BrowserWindow.getAllWindows().length === 1)
  assert.equal(await evaluate(main, 'window.cairo.chatDraft()'), "updated from detached chat")
  // Main window can close while live chat continues; Dock recreates planning.
  await evaluate(main, 'window.cairo.chatWindow("detach")')
  const survivor = BrowserWindow.getAllWindows().find(window => window !== main)
  await ready(survivor)
  main.close()
  await evaluate(survivor, 'void window.cairo.chatWindow("dock")')
  await until(() => BrowserWindow.getAllWindows().length === 1)
  const restored = BrowserWindow.getAllWindows()[0]
  await ready(restored)
  assert.equal(await evaluate(restored, 'window.cairo.view'), "planning")
  assert.equal(await evaluate(restored, 'window.cairo.chatDraft()'), "updated from detached chat")
  assert.deepEqual(shownWindows, [], "No verification window may show or take focus")
  console.log("PASS: document settings persistence and validation; singleton pop-out, shared engine, draft handoff, narrow layout, close, dock, live view, and planning restoration")
  app.quit()
})().catch(error => { console.error(error); exitCode = 1; app.quit() })
