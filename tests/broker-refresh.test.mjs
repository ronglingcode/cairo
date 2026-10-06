import test from "node:test"
import assert from "node:assert/strict"
import { CairoEngine } from "../src/engine/CairoEngine.mts"
import { BrokerRefreshCoordinator } from "../src/engine/BrokerRefreshCoordinator.mts"

const timestamp = "2026-10-04T16:00:00.000Z"

test("startup and failures never schedule recurring broker reads; only notifications refresh again", async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const failed of [false, true]) {
    const engine = new CairoEngine()
    let reads = 0
    const accountReader = { async readSelectedAccount() { reads++; return failed ? { facts: null, status: stale, error: 'unavailable' } : { facts: facts(), status: connected, error: null } } }
    const orderReader = { async readSelectedAccountOrders() { return { accountId: 'acct-1', workingOrders: [], recentFills: [], ordersComplete: true, error: null } } }
    const coordinator = new BrokerRefreshCoordinator(engine, accountReader, orderReader)
    coordinator.start(); t.mock.timers.tick(1); await coordinator.refresh()
    assert.equal(reads, 1)
    t.mock.timers.tick(600_000); await Promise.resolve()
    assert.equal(reads, 1, 'ten quiet minutes must cause no new requests')
    for (let i = 0; i < 20; i++) coordinator.accountActivity()
    t.mock.timers.tick(100); await coordinator.refresh()
    assert.equal(reads, 2)
    t.mock.timers.tick(600_000); await Promise.resolve()
    assert.equal(reads, 2)
    await coordinator.stop()
    coordinator.accountActivity(); t.mock.timers.tick(600_000); await Promise.resolve()
    assert.equal(reads, 2)
  }
})

test("Bookmap activity refreshes promptly, coalesces bursts, and follows an in-flight snapshot", async () => {
  const { BookmapReceiver } = await import('../src/engine/BookmapReceiver.mts')
  const engine = new CairoEngine()
  let reads = 0, release
  const accountReader = { async readSelectedAccount() { reads++; if (reads === 2) await new Promise(resolve => { release = resolve }); return { facts: facts(reads === 1 ? 100 : 70), status: connected, error: null } } }
  const orderReader = { async readSelectedAccountOrders() { return { accountId: 'acct-1', workingOrders: [], recentFills: [], ordersComplete: true, error: null } } }
  const coordinator = new BrokerRefreshCoordinator(engine, accountReader, orderReader, {})
  const receiver = new BookmapReceiver(engine)
  receiver.setAccountActivityHandler(() => coordinator.accountActivity())
  const activity = () => receiver.receive(JSON.stringify({ type: 'cairo_account_activity', receivedAt: Date.now(), messageTypes: ['ExecutionCreated'] }))
  const until = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(predicate()) }
  try {
    coordinator.start(); await until(() => reads === 1 && !coordinator.inFlight)
    for (let i = 0; i < 20; i++) assert.equal(activity(), true)
    await until(() => release !== undefined)
    for (let i = 0; i < 20; i++) activity()
    assert.equal(reads, 2)
    release(); await until(() => reads === 3 && !coordinator.inFlight)
    assert.equal(engine.getSnapshot().positions[0].quantity, 70)
    await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(reads, 3)
    activity(); await coordinator.stop()
    await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(reads, 3)
  } finally { release?.(); await coordinator.stop() }
})
const connected = { source: "broker", state: "connected", updatedAt: timestamp, detail: "synthetic" }
const stale = { source: "broker", state: "stale", updatedAt: timestamp, detail: "token unavailable" }
const facts = (quantity = 10, markPrice = 20, updatedAt = timestamp) => ({
  accountId: "acct-1", asOf: updatedAt,
  positions: [{ positionId: "position-1", symbol: "XYZ", side: "long", quantity, averagePrice: 18, markPrice, markUpdatedAt: updatedAt, markSource: "Schwab account market value" }],
  workingOrders: [{ orderId: "stop-1", symbol: "XYZ", side: "sell", quantity, filledQuantity: 0, status: "working", brokerStatus: "WORKING", orderType: "STOP", parentOrderId: null, ocoGroupId: null }],
  recentFills: [], ordersComplete: true, source: { ...connected, updatedAt },
})

function readerQueue(accountResults, orderResults) {
  return {
    accountReader: { reads: 0, async readSelectedAccount() { this.reads++; return accountResults.shift() } },
    orderReader: { reads: 0, async readSelectedAccountOrders() { this.reads++; return orderResults.shift() } },
  }
}

test("broker refresh coalesces requests and keeps actual fact revision separate from refresh sequence", async () => {
  const engine = new CairoEngine()
  const queue = readerQueue([
    { facts: facts(), status: connected, error: null },
    { facts: facts(10, 20, "2026-10-04T16:00:30.000Z"), status: connected, error: null },
    { facts: facts(9, 20, "2026-10-04T16:01:00.000Z"), status: connected, error: null },
  ], [
    { accountId: "acct-1", workingOrders: facts().workingOrders, recentFills: [], ordersComplete: true, error: null },
    { accountId: "acct-1", workingOrders: facts().workingOrders, recentFills: [], ordersComplete: true, error: null },
    { accountId: "acct-1", workingOrders: facts().workingOrders, recentFills: [], ordersComplete: true, error: null },
  ])
  const coordinator = new BrokerRefreshCoordinator(engine, queue.accountReader, queue.orderReader, { now: () => Date.parse(timestamp) })
  const firstPending = coordinator.refresh()
  assert.equal(coordinator.refresh(), firstPending)
  const first = await firstPending
  const second = await coordinator.refresh()
  const third = await coordinator.refresh()
  assert.deepEqual([first.refreshSequence, second.refreshSequence, third.refreshSequence], [1, 2, 3])
  assert.deepEqual([first.factsRevision, second.factsRevision, third.factsRevision], [1, 1, 2])
  assert.equal(engine.getSnapshot().brokerRefreshSequence, 3)
  assert.equal(engine.getSnapshot().brokerFactsRevision, 2)
  assert.equal(engine.getSnapshot().positions[0].quantity, 9)
})

test("failed account refresh marks facts stale and retains the last known positions/orders", async () => {
  const engine = new CairoEngine()
  const queue = readerQueue([
    { facts: facts(), status: connected, error: null },
    { facts: null, status: stale, error: "token missing" },
  ], [
    { accountId: "acct-1", workingOrders: facts().workingOrders, recentFills: [], ordersComplete: true, error: null },
  ])
  const coordinator = new BrokerRefreshCoordinator(engine, queue.accountReader, queue.orderReader, {})
  await coordinator.refresh()
  const before = engine.getSnapshot()
  const failed = await coordinator.refresh()
  const after = engine.getSnapshot()
  assert.equal(failed.status.state, "stale")
  assert.equal(after.broker.state, "stale")
  assert.deepEqual(after.positions, before.positions)
  assert.deepEqual(after.brokerFacts.workingOrders, before.brokerFacts.workingOrders)
  assert.equal(after.brokerFactsRevision, before.brokerFactsRevision)
  assert.equal(after.brokerRefreshSequence, before.brokerRefreshSequence + 1)
  assert.equal(queue.orderReader.reads, 1)
})

test("stop cancels queued activity refreshes and waits for an in-flight read", async () => {
  const engine = new CairoEngine()
  let finish
  let reads = 0
  const accountReader = { async readSelectedAccount() { reads++; if (reads === 1) await new Promise((resolve) => { finish = resolve }); return { facts: facts(), status: connected, error: null } } }
  const orderReader = { async readSelectedAccountOrders() { return { accountId: "acct-1", workingOrders: [], recentFills: [], ordersComplete: true, error: null } } }
  const coordinator = new BrokerRefreshCoordinator(engine, accountReader, orderReader, {})
  coordinator.start()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(reads, 1)
  const stopping = coordinator.stop()
  finish()
  await stopping
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(coordinator.isStarted, false)
  assert.equal(reads, 1)
})
