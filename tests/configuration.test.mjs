import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { LocalConfiguration } from "../src/engine/LocalConfiguration.mts"

test("local configuration creates defaults under app data paths containing spaces", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo user data "))
  try {
    const store = new LocalConfiguration(root)
    const view = await store.load()
    assert.equal(view.setupRequired, true)
    assert.equal(view.provider, "fake")
    assert.equal(view.chartSymbol, "SPY")
    assert.equal(view.configPath.includes(" "), true)
    assert.deepEqual(JSON.parse(await readFile(view.configPath, "utf8")).selectedAccountId, "")
    assert.equal("massiveApiKey" in view, false)
    assert.equal("openAiApiKey" in view, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("local configuration validates changes and only exposes sanitized settings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo config "))
  try {
    const store = new LocalConfiguration(root)
    await store.load()
    const view = await store.save({ ...store.values, selectedAccountId: "acct-2", provider: "openai", model: "gpt-test" })
    assert.equal(view.setupRequired, false)
    assert.equal(view.selectedAccountId, "acct-2")
    assert.equal(JSON.stringify(view).includes("API_KEY"), false)
    await assert.rejects(store.save({ ...store.values, bookmapEndpoint: "ws://example.com:8765" }), /loopback/)
    await assert.rejects(store.save({ ...store.values, brokerPollIntervalMs: 1 }), /between/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
