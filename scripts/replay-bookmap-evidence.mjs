// Read-only playback of bmtrader evidence JSONL to Cairo's loopback WebSocket.
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

const args=process.argv.slice(2)
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]}
const file=option('--file'),port=Number(option('--port','8765')),speed=Number(option('--speed','1'))
if(!file || !Number.isInteger(port) || port<1 || port>65535 || !Number.isFinite(speed) || speed<=0) {
  console.error('Usage: node scripts/replay-bookmap-evidence.mjs --file <evidence.jsonl> [--port 8765] [--speed 1]')
  process.exit(1)
}
const clients=new Set(),history=[]
let latest=null,playing=false,paused=false
const frame=value=>{
  const body=Buffer.from(JSON.stringify(value));let header
  if(body.length<126) header=Buffer.from([0x81,body.length])
  else if(body.length<65536) {header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(body.length,2)}
  else {header=Buffer.alloc(10);header[0]=0x81;header[1]=127;header.writeBigUInt64BE(BigInt(body.length),2)}
  return Buffer.concat([header,body])
}
const send=(socket,value)=>{if(!socket.destroyed) {if(socket.writableLength>8*1024*1024) socket.destroy(); else socket.write(frame(value))}}
const server=createServer((_,response)=>{response.writeHead(200,{'Content-Type':'text/plain'});response.end('Read-only Bookmap evidence replay\n')})
server.on('upgrade',(request,socket)=>{
  const key=request.headers['sec-websocket-key'];if(typeof key!=='string'){socket.destroy();return}
  const accept=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  clients.add(socket);socket.on('error',()=>clients.delete(socket));socket.on('close',()=>clients.delete(socket))
  socket.on('data',data=>{if((data[0]&0xf)===8) socket.end()})
  for(const batch of history) send(socket,{...batch,delivery:'snapshot'})
  if(!playing) {playing=true;void playback().catch(error=>{console.error(error.message);process.exitCode=1;shutdown()})}
})
const heartbeat=setInterval(()=>{if(latest) for(const client of clients) send(client,{...latest,events:[],delivery:'stream'})},2000)
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function playback() {
  let prior=null,count=0
  for await(const line of createInterface({input:createReadStream(resolve(file)),crlfDelay:Infinity})) {
    if(!line.trim()) continue
    if(line.length>131072) throw new Error('Evidence line exceeds protocol bound')
    const raw=JSON.parse(line);if(raw.type!=='cairo_evidence'||raw.version!==1) throw new Error('Unsupported evidence capture')
    const value={...raw,mode:'replay',delivery:'stream'}
    const time=Number(BigInt(value.eventTime)/1_000_000n)
    let delay=prior===null?0:Math.max(0,(time-prior)/speed)
    while(delay>0) {const slice=Math.min(delay,1000);await wait(slice);delay-=slice}
    prior=time
    if(latest&&(latest.sourceInstanceId!==value.sourceInstanceId||latest.epoch!==value.epoch)) history.length=0
    latest=value;history.push(value)
    while(history.length>160 || history.length>1&&Number(BigInt(history[0].eventTime)/1_000_000n)<time-600000) history.shift()
    for(const client of clients) send(client,value)
    count+=value.events.length
  }
  paused=true;console.log(`Playback complete: ${count} evidence events. Context remains available; Ctrl+C to stop.`)
}
function shutdown(){clearInterval(heartbeat);for(const client of clients)client.destroy();server.close()}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown)
server.on('error',error=>{console.error(`Replay server: ${error.message}. Close Bookmap or choose another port.`);shutdown();process.exitCode=1})
server.listen(port,'127.0.0.1',()=>console.log(`Replay ready at ws://127.0.0.1:${port}; playback starts when Cairo connects. Source: ${resolve(file)}`))
