import test from "node:test"
import assert from "node:assert/strict"
import { FakeClock } from "../src/shared/contracts.mts"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { installShutdownHook } from "../src/engine/installShutdownHook.mts"

test("main-owned engine survives renderer reads and starts in observer-only state", async () => {
  const clock = new FakeClock(Date.parse("2026-10-04T16:00:00Z"))
  const engine = new CairoEngine({ clock, cycleIntervalMs: 10 })
  const originalRuntime = engine.getSnapshot().runtimeInstanceId
  assert.equal(engine.mode, "observer")
  assert.equal(engine.canSubmitOrders, false)
  assert.equal(engine.getSnapshot().bookmap.state, "waiting")

  engine.start()
  const firstRendererRead = engine.getSnapshot()
  const secondRendererRead = engine.getSnapshot()
  assert.equal(firstRendererRead.runtimeInstanceId, originalRuntime)
  assert.equal(secondRendererRead.runtimeInstanceId, originalRuntime)
  assert.equal(engine.isStarted, true)

  const changed = engine.updateSnapshot({ broker: { source: "broker", state: "connected", updatedAt: "2026-10-04T16:00:01Z", detail: "synthetic" } })
  changed.broker.detail = "renderer mutation"
  assert.equal(engine.getSnapshot().broker.detail, "synthetic", "snapshot reads must not leak mutable engine state")
  await engine.stop()
  assert.equal(engine.isStarted, false)
})

test("engine bounds in-memory lists and cancels scheduled cycles on stop", async () => {
  let cycles = 0
  const engine = new CairoEngine({ cycleIntervalMs: 10, runCycle: async () => { cycles++ } })
  engine.updateSnapshot({ tickets: Array.from({ length: 250 }, (_, i) => ({ id: String(i) })) })
  assert.equal(engine.getSnapshot().tickets.length, 200)
  assert.equal(engine.getSnapshot().tickets[0].id, "50")

  engine.start()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await engine.stop()
  const stoppedAt = cycles
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.ok(stoppedAt > 0)
  assert.equal(cycles, stoppedAt)
})

test("application quit waits for engine cleanup and permits only one shutdown", async () => {
  let beforeQuit
  let prevented = 0
  let stopCount = 0
  let quitCount = 0
  let finishStop
  const app = {
    on: (event, listener) => { assert.equal(event, "before-quit"); beforeQuit = listener },
    quit: () => { quitCount++ },
  }
  const engine = { stop: () => { stopCount++; return new Promise((resolve) => { finishStop = resolve }) } }
  installShutdownHook(app, engine)

  beforeQuit({ preventDefault: () => { prevented++ } })
  beforeQuit({ preventDefault: () => { prevented++ } })
  assert.equal(prevented, 2)
  assert.equal(stopCount, 1)
  assert.equal(quitCount, 0)
  finishStop()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(quitCount, 1)
  beforeQuit({ preventDefault: () => { prevented++ } })
  assert.equal(prevented, 2, "second app.quit path must not restart shutdown")
})
