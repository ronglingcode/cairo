import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BookmapTokenProvider } from "../src/engine/BookmapTokenProvider.mts"
import { SchwabAccountReader } from "../src/engine/SchwabAccountReader.mts"

function fakeHttp(responses) {
  const requests = []
  return { requests, async request(url, init) { requests.push({ url, init }); return responses.shift() } }
}

async function harness(t, selectedAccountId, responses) {
  const root = await mkdtemp(path.join(os.tmpdir(), "schwab selected account "))
  const tokenFile = path.join(root, "bookmap secrets.json")
  await writeFile(tokenFile, JSON.stringify({ schwab: { access_token: "fake-token", expires_at: Date.now() + 120_000 } }))
  t.after(() => rm(root, { recursive: true, force: true }))
  const provider = new BookmapTokenProvider(() => ({ selectedAccountId, schwabTokenFile: tokenFile }))
  const http = fakeHttp(responses)
  const reader = new SchwabAccountReader(http, provider)
  return { reader, http, provider }
}

test("Schwab maps the explicitly selected account and normalizes long, short, fractional and carry-in holdings", async (t) => {
  const { reader, http } = await harness(t, "acct-2", [
    { status: 200, body: [{ accountNumber: "acct-1", hashValue: "hash-1" }, { accountNumber: "acct-2", hashValue: "hash-2" }] },
    { status: 200, body: { securitiesAccount: { currentBalances: { liquidationValue: 25000, buyingPower: 8000 }, positions: [
      { instrument: { assetType: "EQUITY", symbol: "AAPL", cusip: "cusip-a" }, longQuantity: 2.5, shortQuantity: 0, averagePrice: 100, marketValue: 275 },
      { instrument: { assetType: "EQUITY", symbol: "XYZ", cusip: "cusip-x" }, longQuantity: 0, shortQuantity: 3, averagePrice: 20, marketValue: -66 },
      { instrument: { assetType: "EQUITY", symbol: "CARRY", cusip: "cusip-c" }, longQuantity: 1, shortQuantity: 0, averagePrice: 5 },
      { instrument: { assetType: "OPTION", symbol: "AAPL 260101C" }, longQuantity: 1, shortQuantity: 0, averagePrice: 1 },
    ] } } },
  ])
  const result = await reader.readSelectedAccount()
  assert.equal(result.status.state, "connected")
  assert.equal(result.facts.accountId, "acct-2")
  assert.deepEqual(result.facts.positions.map((position) => [position.symbol, position.side, position.quantity]), [["AAPL", "long", 2.5], ["XYZ", "short", 3], ["CARRY", "long", 1]])
  assert.equal(result.facts.positions[0].markPrice, 110)
  assert.equal(result.facts.positions[1].markPrice, 22)
  assert.equal(result.facts.positions[0].positionId.includes("cusip-a"), true)
  assert.equal(result.facts.ordersComplete, false)
  assert.deepEqual(result.facts.accountAvailability, { liquidationValue: 25000, buyingPower: 8000, updatedAt: result.facts.asOf })
  assert.equal(result.facts.positions[0].markSource, "Schwab account market value")
  assert.equal(result.facts.positions[0].markUpdatedAt, result.facts.asOf)
  assert.match(http.requests[1].url, /accounts\/hash-2\?fields=positions$/)
  assert.equal(http.requests.every((request) => request.init.headers.Authorization === "Bearer fake-token"), true)
})

test("Schwab never selects the first account and auth failures mark stale without retry", async (t) => {
  const { reader, http, provider } = await harness(t, "unknown", [
    { status: 200, body: [{ accountNumber: "acct-1", hashValue: "hash-1" }, { accountNumber: "acct-2", hashValue: "hash-2" }] },
  ])
  const missing = await reader.readSelectedAccount()
  assert.equal(missing.facts, null)
  assert.match(missing.error, /not available/)
  assert.equal(http.requests.length, 1)

  const authorized = await harness(t, "acct-1", [
    { status: 200, body: [{ accountNumber: "acct-1", hashValue: "hash-1" }] },
    { status: 401, body: "unauthorized" },
  ])
  const rejected = await authorized.reader.readSelectedAccount()
  assert.equal(rejected.status.state, "stale")
  assert.equal(authorized.provider.status.state, "stale")
  assert.equal(authorized.http.requests.length, 2)
})
