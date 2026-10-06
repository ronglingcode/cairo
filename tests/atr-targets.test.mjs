import test from 'node:test'
import assert from 'node:assert/strict'
import { atrTargetContext } from '../src/engine/AtrTargets.mts'
import { CairoEngine } from '../src/engine/CairoEngine.mts'
import { BookmapReceiver } from '../src/engine/BookmapReceiver.mts'

const now = Date.parse('2026-10-06T15:00:00Z')
const market = { symbol: 'AMD', sessionDate: '2026-10-06', timestamp: now, atr: 10, lowOfDay: 100, highOfDay: 110 }
test('ATR long targets use the day low, preserve multiples and round displayed prices to cents', () => {
  const result = atrTargetContext(market, 'long', now)
  assert.equal(result.available, true)
  assert.deepEqual(result.levels.slice(0,2), [{multiple:0.5,price:105}, {multiple:0.8,price:108}])
  assert.equal(atrTargetContext({...market,atr:3.57,lowOfDay:99.23},'long',now).levels[0].price,101.02)
  for (const input of [undefined, {...market,atr:0}, {...market,lowOfDay:0}, {...market,sessionDate:'2026-10-05'}, {...market,timestamp:now-61000}]) assert.equal(atrTargetContext(input,'long',now).available,false)
  assert.equal(atrTargetContext(market,'short',now).available,false)
})
test('Bookmap ATR context updates the day low, rejects old/malformed values and clears on disconnect', () => {
  const receiver = new BookmapReceiver(new CairoEngine(),()=>now)
  const send = changes => receiver.receive(JSON.stringify({type:'cairo_target_market',...market,...changes}))
  assert.equal(send({}),true)
  assert.equal(receiver.atrTargets('AMD','long').levels[0].price,105)
  assert.equal(send({lowOfDay:98}),true)
  assert.equal(receiver.atrTargets('AMD','long').levels[0].price,103)
  assert.equal(send({timestamp:now-1000,lowOfDay:101}),false)
  assert.equal(send({atr:'10'}),false)
  assert.equal(send({highOfDay:97}),false)
  assert.equal(receiver.atrTargets('NVDA','long').available,false)
  receiver.stop()
  assert.equal(receiver.atrTargets('AMD','long').available,false)
})
