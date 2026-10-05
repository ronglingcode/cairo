import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BookmapTokenProvider } from "../src/engine/BookmapTokenProvider.mts"
import { SchwabOrderReader } from "../src/engine/SchwabOrderReader.mts"

const NOW = Date.parse("2026-10-04T17:00:00Z")

function fakeHttp(responses) {
  const requests = []
  return { requests, async request(url, init) { requests.push({ url, init }); return responses.shift() } }
}

async function harness(t, responses, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "schwab orders "))
  const tokenFile = path.join(root, "secret file.json")
  await writeFile(tokenFile, JSON.stringify({ schwab: { access_token: "fake-order-token", expires_at: NOW + 600_000 } }))
  t.after(() => rm(root, { recursive: true, force: true }))
  const token = new BookmapTokenProvider(() => ({ selectedAccountId: "acct-1", schwabTokenFile: tokenFile }), { now: () => NOW })
  const http = fakeHttp([{ status: 200, body: [{ accountNumber: "acct-1", hashValue: "hash-1" }] }, ...responses])
  return { reader: new SchwabOrderReader(http, token, { now: () => NOW, lookbackDays: 60, ...options }), http, token }
}

test("Schwab order reader keeps recursive OCO links, statuses, prior-day protection and deduplicated recent fills", async (t) => {
  const priorDay = new Date(NOW - 2 * 86_400_000).toISOString()
  const fillTime = new Date(NOW - 60_000).toISOString()
  const { reader, http } = await harness(t, [{ status: 200, body: [
    { orderId: 100, orderStrategyType: "SINGLE", status: "WORKING", orderType: "STOP", quantity: 10, orderLegCollection: [{ instruction: "SELL", legId: 1, quantity: 10, instrument: { assetType: "EQUITY", symbol: "XYZ" } }] , enteredTime: priorDay },
    { orderId: 200, orderStrategyType: "OCO", status: "WORKING", childOrderStrategies: [
      { orderId: 201, orderStrategyType: "SINGLE", status: "WORKING", orderType: "STOP", quantity: 5, orderLegCollection: [{ instruction: "SELL", legId: 1, instrument: { assetType: "EQUITY", symbol: "ABC" } }] },
      { orderId: 202, orderStrategyType: "SINGLE", status: "PARTIALLY_FILLED", orderType: "LIMIT", quantity: 5, filledQuantity: 2, orderLegCollection: [{ instruction: "SELL", legId: 2, instrument: { assetType: "EQUITY", symbol: "ABC" } }], orderActivityCollection: [{ activityType: "EXECUTION", executionType: "FILL", executionLegs: [
        { legId: 2, time: fillTime, quantity: 2, price: 13, executionId: "fill-1" },
        { legId: 2, time: fillTime, quantity: 2, price: 13, executionId: "fill-1" },
      ] }] },
    ] },
    { orderId: 300, orderStrategyType: "SINGLE", status: "CANCELED", orderType: "LIMIT", quantity: 4, filledQuantity: 1, orderLegCollection: [{ instruction: "BUY", legId: 1, instrument: { assetType: "EQUITY", symbol: "QWE" } }], orderActivityCollection: [{ activityType: "EXECUTION", executionType: "FILL", executionLegs: [{ legId: 1, time: fillTime, quantity: 1, price: 25 }] }] },
    { orderId: 400, orderStrategyType: "SINGLE", status: "REPLACED", orderType: "LIMIT", quantity: 1, enteredTime: priorDay, orderLegCollection: [{ instruction: "BUY", instrument: { assetType: "EQUITY", symbol: "OLD" } }] },
    { orderId: 500, orderStrategyType: "SINGLE", status: "REJECTED", orderType: "LIMIT", quantity: 1, enteredTime: priorDay, orderLegCollection: [{ instruction: "BUY", instrument: { assetType: "EQUITY", symbol: "BAD" } }] },
    { orderId: 600, orderStrategyType: "SINGLE", status: "EXPIRED", orderType: "LIMIT", quantity: 1, enteredTime: priorDay, orderLegCollection: [{ instruction: "BUY", instrument: { assetType: "EQUITY", symbol: "OLD2" } }] },
    { orderId: 700, orderStrategyType: "SINGLE", status: "FUTURE_STATUS", orderType: "TRAILING_STOP", quantity: 1, orderLegCollection: [{ instruction: "SELL", instrument: { assetType: "EQUITY", symbol: "UNK" } }] },
    { orderId: 800, orderStrategyType: "SINGLE", status: "WORKING", orderType: "LIMIT", quantity: 1, orderLegCollection: [{ instruction: "BUY", instrument: { assetType: "OPTION", symbol: "OPT" } }] },
  ] }])
  const result = await reader.readSelectedAccountOrders()
  assert.equal(result.ordersComplete, true)
  assert.equal(result.workingOrders.find((order) => order.orderId === "100").status, "working")
  const stop = result.workingOrders.find((order) => order.orderId === "201")
  assert.equal(stop.ocoGroupId, "200")
  const target = result.workingOrders.find((order) => order.orderId === "202")
  assert.equal(target.ocoGroupId, "200")
  assert.equal(target.status, "partially-filled")
  assert.equal(target.filledQuantity, 2)
  assert.equal(result.workingOrders.find((order) => order.orderId === "300").status, "canceled")
  assert.equal(result.workingOrders.find((order) => order.orderId === "400").status, "replaced")
  assert.equal(result.workingOrders.find((order) => order.orderId === "500").status, "rejected")
  assert.equal(result.workingOrders.find((order) => order.orderId === "600").status, "expired")
  assert.equal(result.workingOrders.find((order) => order.orderId === "700").status, "unknown")
  assert.equal(result.workingOrders.some((order) => order.symbol === "OPT"), false)
  assert.deepEqual(result.recentFills.map((fill) => fill.fillId).sort(), ["fill-1", result.recentFills.find((fill) => fill.orderId === "300").fillId].sort())
  assert.equal(result.recentFills.length, 2)
  assert.match(http.requests[1].url, /fromEnteredTime=/)
  assert.match(http.requests[1].url, /accounts\/hash-1\/orders/)
  assert.ok(Date.parse(new URL(http.requests[1].url).searchParams.get("fromEnteredTime")) <= Date.parse(priorDay))
  assert.equal(http.requests.every((request) => request.init.method === "GET"), true)
})

test("order result cap subdivides time windows and reports a capped minimum window incomplete", async (t) => {
  const { reader, http } = await harness(t, [
    { status: 200, body: [{ orderId: 1, orderStrategyType: "SINGLE", status: "WORKING", quantity: 1, orderLegCollection: [{ instruction: "BUY", instrument: { assetType: "EQUITY", symbol: "SPY" } }] }, { orderId: 2 }] },
    { status: 200, body: [] },
    { status: 200, body: [
      { orderId: 3, orderStrategyType: "SINGLE", status: "WORKING", quantity: 1, orderLegCollection: [{ instruction: "SELL", instrument: { assetType: "EQUITY", symbol: "SPY" } }] },
      { orderId: 4, orderStrategyType: "SINGLE", status: "WORKING", quantity: 1, orderLegCollection: [{ instruction: "SELL", instrument: { assetType: "EQUITY", symbol: "SPY" } }] },
    ] },
    { status: 200, body: [
      { orderId: 5, orderStrategyType: "SINGLE", status: "WORKING", quantity: 1, orderLegCollection: [{ instruction: "SELL", instrument: { assetType: "EQUITY", symbol: "SPY" } }] },
      { orderId: 6, orderStrategyType: "SINGLE", status: "WORKING", quantity: 1, orderLegCollection: [{ instruction: "SELL", instrument: { assetType: "EQUITY", symbol: "SPY" } }] },
    ] },
  ], { lookbackDays: 1, maxResults: 2, minWindowMs: 43_200_000 })
  const result = await reader.readSelectedAccountOrders()
  assert.equal(result.ordersComplete, false)
  assert.match(result.error, /incomplete/)
  assert.equal(http.requests.length, 4)
})

test("auth failure marks order coverage incomplete without retry", async (t) => {
  const { reader, http, token } = await harness(t, [{ status: 401, body: "unauthorized" }])
  const result = await reader.readSelectedAccountOrders()
  assert.equal(result.ordersComplete, false)
  assert.match(result.error, /rejected/)
  assert.equal(token.status.state, "stale")
  assert.equal(http.requests.length, 2)
})
