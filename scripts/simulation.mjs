import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { TradebookStore } from '../src/engine/TradebookStore.mts'
import { PreparationStore } from '../src/engine/PreparationStore.mts'

export async function loadScenario(directory, sourceRoot, profile) {
  const scenario = JSON.parse(await readFile(path.join(directory, 'scenario.json'), 'utf8'))
  const p = scenario.position
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scenario.date) || !/^[A-Z][A-Z0-9.-]{0,15}$/.test(scenario.symbol) || scenario.id !== `${scenario.date}-${scenario.symbol}` || path.basename(directory) !== scenario.id || !Number.isFinite(Date.parse(`${scenario.date}T00:00:00Z`)) || new Date(`${scenario.date}T00:00:00Z`).toISOString().slice(0, 10) !== scenario.date || !p || !['long', 'short'].includes(p.side) || !Number.isSafeInteger(p.quantity) || p.quantity <= 0 || ![p.averagePrice, p.markPrice].every(n => Number.isFinite(n) && n > 0) || typeof scenario.notes !== 'string' || !Array.isArray(scenario.references)) throw new Error('Invalid date-symbol scenario or position')
  if (scenario.entry && (typeof scenario.entry.at !== 'string' || !scenario.entry.at.startsWith(`${scenario.date}T`) || !/(Z|[+-]\d{2}:\d{2})$/.test(scenario.entry.at) || !Number.isFinite(Date.parse(scenario.entry.at)) || !Number.isSafeInteger(scenario.entry.secondsAfterOpen) || scenario.entry.secondsAfterOpen < 0 || typeof scenario.entry.priceApproximate !== 'boolean')) throw new Error('Entry needs a dated timestamp with timezone, seconds after open and price precision')
  const book = await new TradebookStore(profile, sourceRoot).loadTradebook(scenario.tradebookId)
  if (!book || !book.activeSides.includes(p.side)) throw new Error('Scenario tradebook must be active for the position side')
  const references = []
  for (const reference of scenario.references) {
    const file = path.resolve(sourceRoot, reference)
    if (!file.startsWith(path.resolve(sourceRoot) + path.sep) || !file.endsWith('.md')) throw new Error('References must be Markdown inside the tradebooks root')
    references.push(`## Source: ${reference}\n${await readFile(file, 'utf8')}`)
  }
  const entryContext = scenario.entry ? `\nScenario entry: ${scenario.entry.at}, ${scenario.entry.secondsAfterOpen} seconds after market open. Entry price is ${scenario.entry.priceApproximate ? 'approximate' : 'exact as supplied'}. This timestamp is historical entry context, not the current simulated broker refresh time.\n` : ''
  const markdown = `# SIMULATION: ${scenario.id}\n\n${scenario.notes}\n\nSimulated holding: ${p.quantity} ${p.side} shares at $${p.averagePrice}; simulated mark $${p.markPrice}.${entryContext}\nNo actual broker or live market connection. Scenario date is historical context; broker timestamps track the simulator's current state.\n\n${references.join('\n\n')}\n\n## Source: ${scenario.tradebookId}.md\n${book.markdown}`
  // The copilot context has a 12,000-character preparation budget. Fail rather than hide source clauses.
  if (markdown.length > 12_000) throw new Error('Scenario narrative exceeds copilot context budget; shorten notes or references')
  const preparation = await new PreparationStore(profile).save({ markdown, date: scenario.date, symbol: scenario.symbol, tradebookAssignments: [{ symbol: scenario.symbol, side: p.side, tradebookId: book.id }] }, null)
  return { scenario, book, preparation }
}

/** In-memory transport only. Never delegates a request to fetch or a real broker. */
export class SimulationBroker {
  constructor(engine, scenario) {
    this.engine = engine; this.scenario = scenario; this.orders = []; this.fills = []; this.nextId = 1000; this.revision = 1
    this.position = { ...scenario.position, symbol: scenario.symbol, positionId: `sim-${scenario.id}` }
    this.refresh()
  }
  refresh() {
    const at = new Date().toISOString()
    const source = { source: 'broker', state: 'connected', updatedAt: at, detail: `SIMULATION ${this.scenario.id} · no broker connection` }
    const positions = this.position.quantity ? [{ ...this.position, markUpdatedAt: at }] : []
    const facts = { accountId: `sim-${this.scenario.id}`, asOf: at, positions, workingOrders: this.orders, recentFills: this.fills, ordersComplete: true, source }
    // Refreshing timestamps does not invalidate confirmations or exact tickets; meaningful changes do.
    this.engine.updateSnapshot({ broker: source, brokerFacts: structuredClone(facts), positions, brokerFactsRevision: this.revision })
    return Promise.resolve()
  }
  async request(url, init = {}) {
    if (url === 'https://api.schwabapi.com/trader/v1/accounts/accountNumbers' && (!init.method || init.method === 'GET')) return { status: 200, body: [{ accountNumber: `sim-${this.scenario.id}`, hashValue: 'simulation' }] }
    if (url !== 'https://api.schwabapi.com/trader/v1/accounts/simulation/orders' || init.method !== 'POST') throw new Error('Simulator supports close orders only; unsupported broker route blocked')
    const payload = JSON.parse(init.body)
    const leg = payload.orderLegCollection?.[0]
    const reserved = this.orders.filter(o => o.status === 'working').reduce((sum, o) => sum + o.quantity, 0)
    if (payload.orderLegCollection?.length !== 1 || leg?.instrument?.symbol !== this.scenario.symbol || leg.instrument.assetType !== 'EQUITY' || leg.instruction !== (this.position.side === 'short' ? 'BUY_TO_COVER' : 'SELL') || !Number.isSafeInteger(leg.quantity) || leg.quantity <= 0 || leg.quantity > this.position.quantity - reserved || !['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'].includes(payload.orderType) || payload.session !== 'NORMAL' || payload.duration !== 'DAY' || payload.orderStrategyType !== 'SINGLE') return { status: 400, body: { error: 'Unsupported or increasing simulated order' } }
    const orderId = String(this.nextId++)
    this.orders.push({ orderId, symbol: this.scenario.symbol, side: this.position.side === 'short' ? 'buy' : 'sell', quantity: leg.quantity, filledQuantity: 0, status: 'working', orderType: payload.orderType, instruction: leg.instruction, positionEffect: 'CLOSING', session: 'NORMAL', duration: 'DAY', strategy: 'SINGLE', legCount: 1, parentOrderId: null, ocoGroupId: null, stopPrice: payload.stopPrice ? Number(payload.stopPrice) : null, limitPrice: payload.price ? Number(payload.price) : null })
    this.revision++
    return { status: 201, body: '', headers: { location: `https://simulation.invalid/orders/${orderId}` } }
  }
  async fill(orderId) {
    const order = this.orders.find(o => o.orderId === orderId && o.status === 'working')
    if (!order || order.quantity > this.position.quantity) throw new Error('Current simulated working order required')
    order.status = 'filled'; order.filledQuantity = order.quantity; this.position.quantity -= order.quantity
    this.fills.push({ fillId: `sim-fill-${orderId}`, orderId, symbol: order.symbol, side: order.side, quantity: order.quantity, price: this.position.markPrice, filledAt: new Date().toISOString() })
    this.revision++; await this.refresh()
  }
  async reject(orderId) {
    const order = this.orders.find(o => o.orderId === orderId && o.status === 'working')
    if (!order) throw new Error('Current simulated working order required')
    order.status = 'rejected'; this.revision++; await this.refresh()
  }
  get tokens() { return { readForSelectedAccount: async () => ({ accessToken: 'simulation-only', accountId: `sim-${this.scenario.id}`, expiresAt: Date.now() + 60_000 }), invalidate() {} } }
}
