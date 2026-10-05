import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OpenCodeSidecar } from "../src/copilot/OpenCodeSidecar.mts"
import { CairoEngine } from "../src/engine/CairoEngine.mts"

async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "Cairo sidecar "))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function fakeSpawn() {
  const launches = []
  const spawnProcess = (binary, args, options) => {
    const child = new EventEmitter()
    child.pid = 4000 + launches.length
    child.exitCode = null
    child.signalCode = null
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kills = 0
    child.kill = () => {
      child.kills++
      child.exitCode = 0
      queueMicrotask(() => child.emit("exit", 0))
      return true
    }
    launches.push({ child, binary, args, options })
    queueMicrotask(() => child.stdout.write("server listening on http://127.0.0.1:8760\n"))
    return child
  }
  return { launches, spawnProcess }
}

test("sidecar uses owned paths, loopback auth, and explicit serialized restart/stop", async t => {
  const root = await directory(t)
  const fake = fakeSpawn()
  const engine = new CairoEngine()
  engine.updateSnapshot({ preparation: { markdown: "Keep my notes", revision: "note", savedAt: "2026-10-04T00:00:00Z", date: null, symbol: null } })
  let password
  const sidecar = new OpenCodeSidecar({ binary: "fixture-opencode.exe", userDataPath: root, spawnProcess: fake.spawnProcess,
    onStatus: copilot => engine.updateSnapshot({ copilot }),
    makeClient: (url, key) => {
      assert.equal(url, "http://127.0.0.1:8760")
      password = key
      return { server: { info: async () => ({ version: "2.0.22", pid: fake.launches.at(-1).child.pid }) } }
    },
  })
  t.after(() => sidecar.stop())
  assert.equal(await sidecar.start(), true)
  assert.equal(await sidecar.start(), true)
  assert.equal(fake.launches.length, 1)
  const launched = fake.launches[0]
  assert.equal(launched.options.windowsHide, true)
  assert.equal(launched.options.cwd, path.join(root, "copilot", "workspace"))
  assert.equal(launched.options.env.OPENCODE_SERVER_PASSWORD, password)
  assert.equal(launched.options.env.CAIRO_MASSIVE_API_KEY, undefined)
  assert.equal(launched.options.env.OPENAI_API_KEY, undefined)
  assert.ok(launched.options.env.XDG_DATA_HOME.startsWith(root))
  assert.equal(await sidecar.restart(), true)
  assert.equal(launched.child.kills, 1)
  assert.equal(fake.launches.length, 2)
  await sidecar.stop()
  assert.equal(fake.launches[1].child.kills, 1)
  assert.equal(sidecar.client, undefined)
  assert.equal(sidecar.status.state, "disconnected")
  assert.equal(engine.getSnapshot().preparation.markdown, "Keep my notes")
})

test("failed startup and unexpected runtime identity remain disconnected", async t => {
  const root = await directory(t)
  const failed = new OpenCodeSidecar({ binary: path.join(root, "missing.exe"), userDataPath: root, onStatus: () => {}, startupTimeoutMs: 1000 })
  assert.equal(await failed.start(), false)
  assert.equal(failed.client, undefined)
  const fake = fakeSpawn()
  const wrong = new OpenCodeSidecar({ binary: "fake.exe", userDataPath: root, spawnProcess: fake.spawnProcess, onStatus: () => {},
    makeClient: () => ({ server: { info: async () => ({ version: "1.0.0", pid: 123 }) } }),
  })
  assert.equal(await wrong.start(), false)
  assert.equal(fake.launches[0].child.kills, 1)
  assert.equal(wrong.status.state, "disconnected")
})

test("sidecar crash clears its client without changing broker/chart state", async t => {
  const root = await directory(t)
  const fake = fakeSpawn()
  const engine = new CairoEngine()
  const before = engine.getSnapshot()
  const sidecar = new OpenCodeSidecar({ binary: "fake.exe", userDataPath: root, spawnProcess: fake.spawnProcess,
    onStatus: copilot => engine.updateSnapshot({ copilot }),
    makeClient: () => ({ server: { info: async () => ({ version: "2.0.22", pid: 4000 }) } }),
  })
  t.after(() => sidecar.stop())
  await sidecar.start()
  fake.launches[0].child.exitCode = 1
  fake.launches[0].child.emit("exit", 1)
  assert.equal(sidecar.client, undefined)
  assert.equal(sidecar.status.state, "disconnected")
  assert.deepEqual(engine.getSnapshot().broker, before.broker)
  assert.deepEqual(engine.getSnapshot().chart, before.chart)
})

test("pinned Windows sidecar starts and stops with app-owned storage without model requests", { timeout: 45_000 }, async t => {
  const root = await directory(t)
  const sidecar = new OpenCodeSidecar({
    binary: path.resolve("node_modules/@opencode/cli/bin/opencode.exe"), userDataPath: root, onStatus: () => {},
  })
  t.after(() => sidecar.stop())
  assert.equal(await sidecar.start(), true, sidecar.status.detail)
  const info = await sidecar.client.server.info()
  assert.equal(info.version, "2.0.22")
  assert.equal(info.pid, sidecar.processId)
  await sidecar.stop()
  assert.equal(sidecar.processId, undefined)
})
