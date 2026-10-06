import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CairoEngine } from '../src/engine/CairoEngine.mts'
import { ExitTickets } from '../src/engine/ExitTickets.mts'
import { ExitWriter } from '../src/engine/ExitWriter.mts'
import { RecoveryStore } from '../src/engine/RecoveryStore.mts'
import { PositionGuidance } from '../src/engine/PositionGuidance.mts'
import { ManagementMonitor } from '../src/engine/ManagementMonitor.mts'
import { positionTradebook } from '../src/engine/TradeContext.mts'
import { loadScenario, SimulationBroker } from '../scripts/simulation.mjs'

const scenario = JSON.parse(await readFile(new URL('../test-cases/2026-10-05-PCVX/scenario.json', import.meta.url), 'utf8'))

test('date-symbol case resolves the short tradebook and includes linked management source without editing sources', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cairo-case-test-')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source'); const profile = path.join(root, 'profile'); const directory = path.join(root, scenario.id)
  await mkdir(path.join(source, 'shared'), { recursive: true }); await mkdir(directory)
  await writeFile(path.join(directory, 'scenario.json'), JSON.stringify(scenario))
  await writeFile(path.join(source, 'activeTradebooks.md'), '## Short\n- [Gap and Crap](gap_and_crap.md)\n')
  const markdown = '# Gap and Crap\nFollow the shared three-tier rules.\n'
  await writeFile(path.join(source, 'gap_and_crap.md'), markdown)
  await writeFile(path.join(source, 'shared/3-tier-live-trade-management.md'), '# Three tiers\nRunner needs a trigger.\n')
  const loaded = await loadScenario(directory, source, profile)
  const engine = new CairoEngine(); const broker = new SimulationBroker(engine, scenario)
  engine.updateSnapshot({ tradebooks: [loaded.book], preparation: loaded.preparation })
  const context = positionTradebook(engine.getSnapshot(), engine.getSnapshot().positions[0])
  assert.equal(context.status, 'resolved'); assert.equal(context.book.id, 'gap_and_crap')
  assert.ok(loaded.preparation.markdown.includes('Runner needs a trigger.'))
  assert.ok(loaded.preparation.markdown.includes(scenario.entry.at))
  assert.ok(loaded.preparation.markdown.includes('450 seconds after market open'))
  assert.ok(loaded.preparation.markdown.includes('Entry price is approximate'))
  assert.equal(await readFile(path.join(source, 'gap_and_crap.md'), 'utf8'), markdown)
  const revision = engine.getSnapshot().brokerFactsRevision; await broker.refresh()
  assert.equal(engine.getSnapshot().brokerFactsRevision, revision)
  await writeFile(path.join(directory, 'scenario.json'), JSON.stringify({ ...scenario, references: ['../outside.md'] }))
  await assert.rejects(loadScenario(directory, source, path.join(root, 'other-profile')), /inside the tradebooks root/)
})

test('real approval/writer path uses only simulator; acceptance is not a fill; fill and rejection reconcile', async t => {
  for (const outcome of ['fill', 'reject']) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cairo-sim-writer-')); t.after(() => rm(root, { recursive: true, force: true }))
    const engine = new CairoEngine(); const broker = new SimulationBroker(engine, scenario)
    const tickets = new ExitTickets(engine); const recovery = new RecoveryStore(root); await recovery.load()
    const monitor = new ManagementMonitor(engine, new PositionGuidance(engine))
    const writer = new ExitWriter({ engine, tickets, recovery, monitor, http: broker, tokens: broker.tokens, refresh: () => broker.refresh() })
    const intent = { intent: 'close', accountId: `sim-${scenario.id}`, positionId: `sim-${scenario.id}`, symbol: 'PCVX', positionSide: 'short', factsRevision: 1, quantity: 10, orderType: 'market', reason: 'Synthetic scalp relief', commandId: `sim-${outcome}-001` }
    const unapproved = tickets.stage(intent, 'trader')
    await assert.rejects(writer.submit(unapproved.id, unapproved.reviewHash), /approval/)
    assert.equal(broker.orders.length, 0)
    const ticket = tickets.stage({ ...intent, commandId: `sim-${outcome}-002` }, 'trader')
    assert.equal(ticket.exactPayload.orderLegCollection[0].instruction, 'BUY_TO_COVER')
    tickets.approve(ticket.id, ticket.reviewHash)
    const attempt = await writer.submit(ticket.id, ticket.reviewHash)
    assert.equal(attempt.state, 'accepted'); assert.equal(engine.getSnapshot().positions[0].quantity, scenario.position.quantity)
    await writer.submit(ticket.id, ticket.reviewHash); assert.equal(broker.orders.length, 1)
    await broker[outcome](attempt.brokerOrderId); writer.reconcileKnown()
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(recovery.snapshot.attempts[0].state, outcome === 'fill' ? 'filled' : 'rejected')
    assert.equal(engine.getSnapshot().positions[0].quantity, scenario.position.quantity - (outcome === 'fill' ? 10 : 0))
    await broker.refresh(); assert.equal(engine.getSnapshot().brokerFacts.workingOrders[0].status, outcome === 'fill' ? 'filled' : 'rejected')
    await writer.stop()
  }
})

test('simulation transport blocks real account routes, opening instructions and oversized exits', async () => {
  const broker = new SimulationBroker(new CairoEngine(), scenario)
  await assert.rejects(broker.request('https://api.schwabapi.com/trader/v1/accounts/REAL/orders', { method: 'POST', body: '{}' }), /route blocked/)
  for (const [instruction, quantity] of [['SELL_SHORT', 10], ['BUY_TO_COVER', scenario.position.quantity + 1]]) {
    const response = await broker.request('https://api.schwabapi.com/trader/v1/accounts/simulation/orders', { method: 'POST', body: JSON.stringify({ orderType: 'MARKET', session: 'NORMAL', duration: 'DAY', orderStrategyType: 'SINGLE', orderLegCollection: [{ instruction, quantity, instrument: { symbol: 'PCVX', assetType: 'EQUITY' } }] }) })
    assert.equal(response.status, 400)
  }
  assert.equal(broker.orders.length, 0)
})
