import test from "node:test"
import assert from "node:assert/strict"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { EngineApiServer } from "../src/engine/EngineApiServer.mts"

async function startApi(engine) {
  const api = new EngineApiServer(engine)
  const baseUrl = await api.start()
  return { api, baseUrl }
}

async function readSseEvent(reader) {
  const decoder = new TextDecoder()
  while (true) {
    const { value, done } = await reader.read()
    if (done) throw new Error("event stream closed before next event")
    const text = decoder.decode(value)
    if (text.includes("event:")) return text
  }
}

test("loopback API exposes health and snapshot as read-only JSON", async (t) => {
  const engine = new CairoEngine()
  const { api, baseUrl } = await startApi(engine)
  t.after(() => api.stop())

  const healthResponse = await fetch(`${baseUrl}/health`)
  const health = await healthResponse.json()
  assert.equal(health.ok, true)
  assert.equal(health.mode, "observer")
  assert.equal(health.runtimeInstanceId, engine.runtimeInstanceId)
  assert.equal(healthResponse.headers.get("access-control-allow-origin"), "*")

  const snapshotResponse = await fetch(`${baseUrl}/snapshot`)
  const snapshot = await snapshotResponse.json()
  assert.equal(snapshot.sequence, 0)
  assert.equal(snapshot.broker.state, "waiting")
  assert.equal((await fetch(`${baseUrl}/not-a-route`)).status, 404)
  assert.equal((await fetch(`${baseUrl}/snapshot`, { method: "POST" })).status, 405)
})

test("snapshot cursor catches an update in the snapshot-subscription gap exactly once", async (t) => {
  const engine = new CairoEngine()
  const { api, baseUrl } = await startApi(engine)
  t.after(() => api.stop())

  const initial = await (await fetch(`${baseUrl}/snapshot`)).json()
  engine.updateSnapshot({ broker: { source: "broker", state: "connected", updatedAt: "2026-10-04T16:00:01Z", detail: "synthetic" } })

  const controller = new AbortController()
  const eventResponse = await fetch(`${baseUrl}/events?instance=${initial.runtimeInstanceId}&after=${initial.sequence}`, { signal: controller.signal })
  assert.equal(eventResponse.headers.get("content-type"), "text/event-stream; charset=utf-8")
  const reader = eventResponse.body.getReader()
  const first = await readSseEvent(reader)
  const firstData = JSON.parse(first.split("\n").find((line) => line.startsWith("data: ")).slice(6))
  assert.equal(firstData.sequence, 1)
  assert.equal(firstData.changes.broker.state, "connected")

  engine.updateSnapshot({ copilot: { source: "copilot", state: "disconnected", updatedAt: null, detail: "synthetic disconnect" } })
  const second = await readSseEvent(reader)
  const secondData = JSON.parse(second.split("\n").find((line) => line.startsWith("data: ")).slice(6))
  assert.equal(secondData.sequence, 2)
  assert.equal(secondData.changes.copilot.state, "disconnected")
  controller.abort()
  await reader.cancel().catch(() => undefined)
  for (let attempt = 0; attempt < 50 && engine.listenerCount > 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(engine.listenerCount, 0)
})

test("runtime changes and event-buffer gaps ask clients to refetch current state", async (t) => {
  const engine = new CairoEngine()
  const { api, baseUrl } = await startApi(engine)
  t.after(() => api.stop())
  const readerFor = async (instance, after) => {
    const response = await fetch(`${baseUrl}/events?instance=${instance}&after=${after}`)
    assert.equal(response.status, 200)
    return response.body.getReader()
  }

  const changedRuntimeReader = await readerFor("previous-runtime", 99)
  const runtimeEvent = await readSseEvent(changedRuntimeReader)
  assert.match(runtimeEvent, /event: resync/)
  assert.match(runtimeEvent, /runtime-changed/)

  const instance = engine.runtimeInstanceId
  for (let index = 0; index < 130; index++) engine.updateSnapshot({ copilot: { source: "copilot", state: "waiting", updatedAt: null, detail: `event-${index}` } })
  const gapReader = await readerFor(instance, 0)
  const gapEvent = await readSseEvent(gapReader)
  assert.match(gapEvent, /event: resync/)
  assert.match(gapEvent, /event-gap/)
  const current = await (await fetch(`${baseUrl}/snapshot`)).json()
  assert.equal(current.sequence, 130)
  assert.equal(engine.listenerCount, 0)
})
