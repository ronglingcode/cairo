import test from "node:test"
import assert from "node:assert/strict"
import {
  FakeBroker,
  FakeClock,
  FakeHttp,
  FakeObservationSource,
  parseBookmapObservation,
  parseBrokerFacts,
  parseChartSnapshot,
  parseExitTicket,
} from "../src/shared/contracts.mts"

const baseSource = { source: "bookmap", state: "connected", updatedAt: "2026-10-04T16:00:00-07:00", detail: null }

test("chart snapshots require timestamped one-minute bars with finite consistent prices", () => {
  const snapshot = parseChartSnapshot({
    symbol: "aapl", interval: "1m", fetchedAt: "2026-10-04T16:00:01Z", latestBarAt: null,
    source: { ...baseSource, source: "chart" },
    bars: [{ time: 1791158400000, open: 10, high: 12, low: 9, close: 11, volume: 0 }],
  })
  assert.equal(snapshot.symbol, "AAPL")
  assert.equal(snapshot.bars[0].volume, 0)
  assert.throws(() => parseChartSnapshot({ symbol: "AAPL", interval: "1m", fetchedAt: "2026-10-04T16:00:01Z", latestBarAt: null, source: { ...baseSource, source: "chart" }, bars: [{ time: 1, open: 10, high: 9, low: 8, close: 10, volume: 1 }] }), /inconsistent OHLC/)
  assert.throws(() => parseChartSnapshot({ symbol: "AAPL", interval: "1m", fetchedAt: "2026-10-04T16:00:01Z", latestBarAt: null, source: { ...baseSource, source: "chart" }, bars: [{ time: 1, open: Number.NaN, high: 12, low: 9, close: 11, volume: 1 }] }), /finite number/)
})

test("Bookmap observations preserve nanoseconds and reject unknown enum values", () => {
  const receivedAt = "1791158400123456789"
  const observation = parseBookmapObservation({
    sourceInstanceId: "bm-instance", sequence: 12, symbol: { source: "AAPL.US", canonical: "AAPL" },
    priceUnit: "USD", episodeId: "episode-1", revision: 2, pattern: "bid-reappear", price: 244.25,
    eventTime: "1791158400123000000", receivedAt, detectorRevision: "d1", configRevision: "c1",
    mode: "unknown", readiness: "unknown", kind: "episode",
  })
  assert.equal(observation.receivedAt, receivedAt)
  assert.equal(typeof observation.receivedAt, "string")
  assert.equal(observation.mode, "unknown")
  assert.throws(() => parseBookmapObservation({ ...observation, mode: "maybe-live" }), /expected one of live, replay, unknown/)
  assert.throws(() => parseBookmapObservation({ ...observation, price: Infinity }), /finite number/)
  assert.throws(() => parseBookmapObservation({ ...observation, receivedAt: 1791158400123456789 }), /nanoseconds as a digit string/)
})

test("broker facts and exit tickets reject absent or malformed boundaries", () => {
  const facts = parseBrokerFacts({
    accountId: "account-1", asOf: "2026-10-04T16:00:00Z", ordersComplete: true,
    source: { ...baseSource, source: "broker" },
    positions: [{ positionId: "pos-1", symbol: "aapl", side: "long", quantity: 10, averagePrice: 200, markPrice: null }],
    workingOrders: [], recentFills: [],
  })
  assert.equal(facts.positions[0].symbol, "AAPL")
  const orderStatuses = ["working", "partially-filled", "cancel-pending", "filled", "canceled", "replaced", "rejected", "expired", "unknown"]
  for (const status of orderStatuses) {
    const normalized = parseBrokerFacts({ ...facts, workingOrders: [{ orderId: `o-${status}`, symbol: "AAPL", side: "sell", quantity: 4, filledQuantity: 1, status, orderType: "STOP", parentOrderId: "parent-1", ocoGroupId: "oco-1", brokerStatus: status.toUpperCase() }] })
    assert.equal(normalized.workingOrders[0].status, status)
  }
  assert.throws(() => parseBrokerFacts({ accountId: "account-1" }), /arrays are required/)
  assert.throws(() => parseBrokerFacts({ ...facts, positions: [{ ...facts.positions[0], quantity: 0 }] }), /finite number in range/)

  const ticket = parseExitTicket({
    id: "ticket-1", accountId: "account-1", symbol: "aapl", positionSide: "long", action: "close",
    quantity: 2, orderId: null, request: { orderType: "limit", quantity: 2, limitPrice: 201.25, stopPrice: null, duration: "DAY" },
    reason: "Synthetic review", sourceClauseId: null, expiresAt: "2026-10-04T16:01:00Z", state: "staged",
  })
  assert.equal(ticket.symbol, "AAPL")
  assert.throws(() => parseExitTicket({ ...ticket, request: { ...ticket.request, limitPrice: Number.NaN } }), /finite number/)
  assert.throws(() => parseExitTicket({ ...ticket, action: "open" }), /expected one of close/)
})

test("fakes are deterministic and make no network or broker writes", async () => {
  const clock = new FakeClock(1000)
  clock.advance(500)
  assert.equal(clock.now(), 1500)

  const http = new FakeHttp()
  http.enqueue({ status: 200, body: { ok: true } })
  assert.deepEqual(await http.request("https://fake.invalid/health"), { status: 200, body: { ok: true } })
  assert.equal(http.requests.length, 1)
  assert.equal(http.requests[0].method, "GET")

  const facts = parseBrokerFacts({
    accountId: "account-1", asOf: "2026-10-04T16:00:00Z", ordersComplete: true,
    source: { ...baseSource, source: "broker" }, positions: [], workingOrders: [], recentFills: [],
  })
  const broker = new FakeBroker(facts)
  assert.equal((await broker.readAccount("account-1")).accountId, "account-1")
  assert.deepEqual(broker.accountReads, ["account-1"])

  const source = new FakeObservationSource()
  let received = 0
  const unsubscribe = await source.subscribe({ onObservation: () => { received++ }, onStatus: () => {} })
  assert.equal(source.subscriberCount, 1)
  source.emit({
    sourceInstanceId: "bm-instance", sequence: 1, symbol: { source: "AAPL", canonical: "AAPL" },
    priceUnit: "USD", episodeId: "ep1", revision: 1, pattern: "test", price: null, eventTime: null,
    receivedAt: "1", detectorRevision: null, configRevision: null, mode: "unknown", readiness: "unknown", kind: "heartbeat",
  })
  assert.equal(received, 1)
  unsubscribe()
  assert.equal(source.subscriberCount, 0)
})
