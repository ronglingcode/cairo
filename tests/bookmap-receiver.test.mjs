import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { CairoEngine } from '../src/engine/CairoEngine.mts'
import { BookmapReceiver } from '../src/engine/BookmapReceiver.mts'
export function wire(now, changes = {}) { return JSON.stringify({ type: 'cairo_observation', sourceInstanceId: 'source-1', sequence: 1, symbol: { source: 'AAPL:NASDAQ@BMD', canonical: 'AAPL' }, priceUnit: 'USD', episodeId: 'e1', revision: 1, pattern: 'BID_REAPPEAR', price: 100, eventTime: String(BigInt(now) * 1000000n), receivedAt: String(BigInt(now) * 1000000n), detectorRevision: 'd1', configRevision: 'c1', mode: 'live', readiness: 'ready', delivery: 'live', kind: 'episode', ...changes }) }

test('account activity accepts bounded fresh hints without changing Bookmap market readiness', () => {
  const now = Date.now(), engine = new CairoEngine(), receiver = new BookmapReceiver(engine, () => now)
  let hints = 0; receiver.setAccountActivityHandler(() => hints++)
  const send = changes => receiver.receive(JSON.stringify({ type: 'cairo_account_activity', receivedAt: now, messageTypes: ['ExecutionCreated'], ...changes }))
  assert.equal(send({}), true)
  assert.equal(send({ receivedAt: now - 61000 }), false)
  assert.equal(send({ receivedAt: now + 6000 }), false)
  assert.equal(send({ messageTypes: ['<xml>'] }), false)
  assert.equal(send({ messageTypes: Array(33).fill('ExecutionCreated') }), false)
  assert.equal(hints, 1)
  assert.notEqual(engine.getSnapshot().bookmap.state, 'connected')
})
test('bounded projection deduplicates revisions, suppresses bootstrap, validates units and resets', () => {
  let now = Date.now(); const engine = new CairoEngine(); const receiver = new BookmapReceiver(engine, () => now)
  receiver.receive(wire(now, { kind: 'heartbeat' })); assert.equal(engine.getSnapshot().bookmap.state, 'connected')
  receiver.receive(wire(now, { delivery: 'snapshot' })); assert.equal(engine.getSnapshot().bookmapProjection.episodes[0].freshEvent, false)
  assert.equal(receiver.receive(wire(now)), false)
  receiver.receive(wire(now, { sequence: 3, revision: 2, id: 'changed-uuid' })); assert.equal(engine.getSnapshot().bookmapProjection.episodes.length, 1); assert.equal(engine.getSnapshot().bookmapProjection.episodes[0].freshEvent, false)
  assert.equal(receiver.receive(wire(now, { priceUnit: 'ticks' })), false); assert.equal(receiver.receive(wire(now, { pattern: 'OFFER_REAPPEAR' })), false)
  receiver.receive(wire(now, { kind: 'reset', sequence: 4 })); assert.equal(engine.getSnapshot().bookmapProjection.episodes.length, 0)
  receiver.receive(wire(now, { kind: 'heartbeat', mode: 'replay' })); assert.equal(engine.getSnapshot().bookmapProjection.symbols.AAPL.mode, 'replay')
  now += 6001; receiver.tick(); assert.equal(engine.getSnapshot().bookmap.state, 'stale')
  receiver.receive(wire(now, { sourceInstanceId: 'source-2', mode: 'unknown' })); assert.equal(engine.getSnapshot().bookmapProjection.sourceInstanceId, 'source-2')
})
test('actual loopback WebSocket delivers additive observation without outgoing commands', async () => {
  const server = createServer(); let connected; const ready = new Promise(resolve => connected = resolve)
  let socket; server.on('upgrade', (request, connection) => {
    socket = connection; const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    connection.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    for (const payload of [wire(Date.now(), { kind: 'heartbeat' }), JSON.stringify({ type: 'cairo_account_activity', receivedAt: Date.now(), messageTypes: ['ExecutionCreated'] })]) {
      const message = Buffer.from(payload); const header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(message.length, 2); connection.write(Buffer.concat([header, message]))
    }
    connected()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const engine = new CairoEngine(); const receiver = new BookmapReceiver(engine)
  let activities = 0; receiver.setAccountActivityHandler(() => activities++)
  try { receiver.start(`ws://127.0.0.1:${server.address().port}`); await ready; for (let i = 0; i < 50 && (engine.getSnapshot().bookmap.state !== 'connected' || activities < 2); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(engine.getSnapshot().bookmap.state, 'connected'); assert.equal(activities, 2); assert.equal(engine.getSnapshot().tickets.length, 0) }
  finally { receiver.stop(); socket?.destroy(); await new Promise(resolve => server.close(resolve)) }
})
