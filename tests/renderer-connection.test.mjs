import test from "node:test"
import assert from "node:assert/strict"
import { EngineConnection } from "../src/renderer/EngineConnection.mts"

function snapshot(runtimeInstanceId, sequence) {
  const status = (source) => ({ source, state: "waiting", updatedAt: null, detail: null })
  return {
    runtimeInstanceId, sequence, brokerFactsRevision: 0, brokerRefreshSequence: 0, chart: null, bookmap: status("bookmap"), broker: status("broker"), brokerFacts: null,
    copilot: status("copilot"), positions: [], tradebooks: [], attachments: [], tickets: [],
  }
}

class FakeEventSource {
  listeners = new Map()
  closed = false
  onopen = null
  onerror = null
  addEventListener(type, listener) { this.listeners.set(type, listener) }
  close() { this.closed = true }
  dispatch(type, data = "") { this.listeners.get(type)?.({ data }) }
  open() { this.onopen?.() }
  fail() { this.onerror?.() }
}

class FakeTransport {
  snapshots
  fetchCalls = []
  eventSources = []
  constructor(snapshots) { this.snapshots = [...snapshots] }
  async fetch(url, { signal }) {
    this.fetchCalls.push({ url, signal })
    const value = this.snapshots.shift()
    if (!value) throw new Error("no fixture snapshot")
    return { ok: true, status: 200, json: async () => structuredClone(value) }
  }
  eventSource(url) {
    const source = new FakeEventSource()
    source.url = new URL(url)
    this.eventSources.push(source)
    return source
  }
}

async function waitFor(predicate) {
  for (let count = 0; count < 50; count++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail("condition did not become true")
}

test("renderer applies ordered updates once, refetches on gaps/runtime changes, and reconnects", async () => {
  const transport = new FakeTransport([snapshot("runtime-a", 0), snapshot("runtime-a", 2), snapshot("runtime-b", 0)])
  const snapshots = []
  const states = []
  const connection = new EngineConnection("http://127.0.0.1:41000", {
    onSnapshot: (value) => snapshots.push(value),
    onState: (value) => states.push(value),
  }, transport)
  await connection.connect()
  assert.equal(transport.eventSources[0].url.searchParams.get("after"), "0")
  transport.eventSources[0].open()
  assert.equal(states.at(-1), "connected")

  const update = { runtimeInstanceId: "runtime-a", sequence: 1, changes: { broker: { source: "broker", state: "connected", updatedAt: null, detail: "fixture" } } }
  transport.eventSources[0].dispatch("update", JSON.stringify(update))
  transport.eventSources[0].dispatch("update", JSON.stringify(update))
  assert.equal(snapshots.at(-1).sequence, 1)
  assert.equal(snapshots.at(-1).broker.state, "connected")
  assert.equal(snapshots.filter((item) => item.sequence === 1).length, 1, "duplicate replay must not duplicate a state update")

  transport.eventSources[0].dispatch("update", JSON.stringify({ ...update, sequence: 3 }))
  await waitFor(() => transport.fetchCalls.length === 2)
  await waitFor(() => transport.eventSources.length === 2)
  assert.equal(transport.eventSources[0].closed, true)
  assert.equal(transport.eventSources[1].url.searchParams.get("after"), "2")

  transport.eventSources[1].dispatch("resync")
  await waitFor(() => transport.fetchCalls.length === 3)
  await waitFor(() => transport.eventSources.length === 3)
  assert.equal(transport.eventSources[1].closed, true)
  assert.equal(snapshots.at(-1).runtimeInstanceId, "runtime-b")
  assert.equal(snapshots.at(-1).sequence, 0)
  connection.close()
  assert.equal(transport.eventSources[2].closed, true)
})

test("renderer disposes the event stream and pending retry when unmounted", async () => {
  const transport = new FakeTransport([snapshot("runtime-a", 0), snapshot("runtime-a", 0)])
  const connection = new EngineConnection("http://127.0.0.1:41000", { onSnapshot: () => {}, onState: () => {} }, transport)
  await connection.connect()
  transport.eventSources[0].fail()
  connection.close()
  await new Promise((resolve) => setTimeout(resolve, 550))
  assert.equal(transport.fetchCalls.length, 1)
  assert.equal(transport.eventSources[0].closed, true)
})
