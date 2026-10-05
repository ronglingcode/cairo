import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

test("desktop shell uses an isolated preload and only calls the loopback engine API", async () => {
  const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8")
  const preload = await readFile(new URL("../electron/preload.ts", import.meta.url), "utf8")
  const app = await readFile(new URL("../src/ui/App.tsx", import.meta.url), "utf8")

  assert.match(main, /contextIsolation: true/)
  assert.match(main, /nodeIntegration: false/)
  assert.match(main, /sandbox: true/)
  assert.match(preload, /mode: "fake"/)
  assert.match(app, /no model connected/)
  assert.match(app, /fetch\(`\$\{apiBaseUrl\}\/chart\/refresh`/)
  assert.doesNotMatch(app, /WebSocket\s*\(|fetch\(\s*["']https?:\/\//)
})
