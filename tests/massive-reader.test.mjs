import test from "node:test"
import assert from "node:assert/strict"
import { MassiveRestReader } from "../src/engine/MassiveRestReader.mts"

const first = { t: 1791129600000, o: 10, h: 11, l: 9, c: 10, v: 100 }
const second = { t: 1791129660000, o: 10, h: 12, l: 10, c: 11, v: 200 }

function fakeHttp(responses) {
  const requests = []
  return {
    requests,
    async request(url, init) {
      requests.push({ url, init })
      const response = responses.shift()
      if (response instanceof Error) throw response
      return response
    },
  }
}

test("Massive reader paginates one-minute aggregates and preserves empty snapshots", async () => {
  const http = fakeHttp([
    { status: 200, body: { status: "OK", results: [first], next_url: "https://api.massive.com/v2/aggs/page/2" } },
    { status: 200, body: { status: "OK", results: [second] } },
    { status: 200, body: { status: "OK", results: [] } },
  ])
  const reader = new MassiveRestReader(http, () => "test-secret")
  const loaded = await reader.refresh("spy", "2026-10-04", "2026-10-04T16:01:00.000Z")
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.snapshot.bars.map((bar) => bar.volume), [100, 200])
  assert.equal(loaded.snapshot.latestBarAt, new Date(second.t).toISOString())
  assert.equal(http.requests.length, 2)
  assert.equal(http.requests[0].init.headers.Authorization, "Bearer test-secret")
  assert.equal(new URL(http.requests[0].url).searchParams.has("apiKey"), false)
  assert.equal(http.requests.some(({ url }) => url.includes("/trades/") || url.startsWith("ws")), false)
  const empty = await reader.refresh("SPY", "2026-10-04")
  assert.equal(empty.ok, true)
  assert.deepEqual(empty.snapshot.bars, [])
  assert.equal(empty.snapshot.latestBarAt, null)
})

test("overlapping minute bars replace instead of accumulating volume and errors keep the prior snapshot", async () => {
  const revised = { ...first, c: 10.5, h: 11.5, v: 35 }
  const http = fakeHttp([
    { status: 200, body: { results: [first, second] } },
    { status: 200, body: { results: [revised] } },
    { status: 503, body: "unavailable" },
  ])
  const reader = new MassiveRestReader(http, () => "fake")
  await reader.refresh("SPY", "2026-10-04")
  const merged = await reader.refresh("SPY", "2026-10-04")
  assert.equal(merged.snapshot.bars.length, 2)
  assert.equal(merged.snapshot.bars[0].volume, 35)
  assert.equal(merged.snapshot.bars[1].volume, 200)
  const failed = await reader.refresh("SPY", "2026-10-04")
  assert.equal(failed.ok, false)
  assert.deepEqual(failed.snapshot, merged.snapshot)
  assert.equal(reader.getSnapshot("SPY", "2026-10-04").bars[0].volume, 35)
})

test("missing key and unsafe pagination fail without exposing the credential", async () => {
  const noKey = new MassiveRestReader(fakeHttp([]), () => null)
  assert.match((await noKey.refresh("SPY", "2026-10-04")).error, /not configured/)
  const http = fakeHttp([{ status: 200, body: { results: [first], next_url: "https://attacker.invalid/collect" } }])
  const reader = new MassiveRestReader(http, () => "secret-value")
  const result = await reader.refresh("SPY", "2026-10-04")
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(result).includes("secret-value"), false)
  assert.equal(http.requests.length, 1)
})
