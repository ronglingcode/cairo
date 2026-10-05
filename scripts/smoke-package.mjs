import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm, rename } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const packagePath = path.resolve(process.argv[2] ?? ''); if (!process.argv[2]) throw new Error('Pass unpacked package path')
const manifest = JSON.parse(await readFile(path.join(packagePath, 'BUILD-MANIFEST.json'), 'utf8'))
const profile = await mkdtemp(path.join(os.tmpdir(), 'Cairo packaged smoke ')); const tokenFile = path.join(profile, 'synthetic secrets.json')
await writeFile(tokenFile, JSON.stringify({ schwab: { access_token: 'synthetic-one', expires_at: Date.now() + 600000 } }))
const sockets = new Set(); const observationServer = createServer(); let sourceId = 'fake-bookmap-1', sequence = 0
function broadcast(kind, delivery = 'live') { const now = Date.now(); const bytes = Buffer.from(JSON.stringify({type:'cairo_observation',sourceInstanceId:sourceId,sequence:++sequence,symbol:{source:'AAPL',canonical:'AAPL'},priceUnit:'USD',episodeId:'smoke-episode',revision:1,pattern:'BID_REAPPEAR',price:101,eventTime:String(BigInt(now)*1000000n),receivedAt:String(BigInt(now)*1000000n),detectorRevision:'fake',configRevision:'fake',mode:'unknown',readiness:'ready',delivery,kind})); const header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(bytes.length,2);for(const socket of sockets)socket.write(Buffer.concat([header,bytes])) }
observationServer.on('upgrade',(request,socket)=>{const accept=createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);sockets.add(socket);socket.on('error',()=>{sockets.delete(socket);socket.destroy()});socket.on('close',()=>sockets.delete(socket));broadcast('heartbeat');broadcast('episode','snapshot')})
await new Promise(resolve=>observationServer.listen(0,'127.0.0.1',resolve));const heartbeat=setInterval(()=>broadcast('heartbeat'),2000)
await writeFile(path.join(profile, 'config.json'), JSON.stringify({ provider: 'fake', selectedAccountId: 'fixture', schwabTokenFile: tokenFile, bookmapEndpoint: `ws://127.0.0.1:${observationServer.address().port}`, brokerPollIntervalMs: 5000 }))
let child, inspector, nextId = 0; const pending = new Map(); let debugOutput = ''; let sidecarPid; let paused = false
async function until(action, predicate, label) { for (let i = 0; i < 150; i++) { const value = await action(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)) } throw new Error(`Timed out: ${label}`) }
async function send(method, params = {}) { const id = ++nextId; return new Promise((resolve, reject) => { const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Inspector timeout: ${method}`)) }, 15000); pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result) }, reject }); inspector.send(JSON.stringify({ id, method, params })) }) }
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: !paused, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value }
const electron = `process.getBuiltinModule('module').createRequire(process.cwd() + '/package-smoke.cjs')('electron')`
const window = `${electron}.BrowserWindow.getAllWindows()[0]`
async function renderer(expression) { return evaluate(`${window}.webContents.executeJavaScript(${JSON.stringify(expression)})`) }
async function snapshot() { return renderer(`fetch(window.cairo.apiBaseUrl+'/snapshot').then(r=>r.json())`) }
async function command(route, body = {}) { return renderer(`fetch(window.cairo.apiBaseUrl+${JSON.stringify(route)},{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+window.cairo.commandToken},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>({status:r.status,body:await r.json()}))`) }
try {
  let previousRuntime; const binary = path.join(packagePath,'resources','opencode','opencode.exe'); let hidden = false
  for (const run of [1,2]) {
  debugOutput='';paused=false
  if(run===2){await rename(binary,binary+'.smoke-hidden');hidden=true}
  child = spawn(path.join(packagePath, 'Cairo.exe'), ['--inspect-brk=0'], { cwd: packagePath, windowsHide: true, env: { ...process.env, PATH: process.env.SystemRoot + '/System32', CAIRO_USER_DATA: profile, CAIRO_OPENAI_API_KEY: '', CAIRO_MASSIVE_API_KEY: 'synthetic' }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.on('data', data => { debugOutput += data.toString() }); child.stdout.on('data', () => {})
  const url = await until(async () => debugOutput.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0], Boolean, 'main inspector')
  inspector = new WebSocket(url); inspector.addEventListener('message', event => { const value = JSON.parse(event.data); if(value.method==='Debugger.paused') paused=true; const callback = pending.get(value.id); if (callback) { pending.delete(value.id); if (value.error) callback.reject(new Error(value.error.message)); else callback.resolve(value.result) } })
  await new Promise((resolve, reject) => { inspector.addEventListener('open', resolve, { once: true }); inspector.addEventListener('error', reject, { once: true }) }); await send('Runtime.enable')
  await send('Debugger.enable'); await send('Runtime.runIfWaitingForDebugger'); await until(async () => paused, Boolean, 'initial script breakpoint')
  // Replace ALL external network access before the app runs. Local fake model/API remains real loopback.
  await evaluate(`globalThis.__smoke={writes:0,tokens:[],chartFail:false}; globalThis.__originalFetch=globalThis.fetch; globalThis.fetch=async function(input,init={}) { const url=String(input); if(new URL(url).hostname==='127.0.0.1') return __originalFetch(input,init); if(init.method && init.method!=='GET') { __smoke.writes++; throw Error('Synthetic smoke prohibits external mutations'); } if(url.includes('api.schwabapi.com')) { __smoke.tokens.push(init.headers?.Authorization); const body=url.includes('accountNumbers')?[{accountNumber:'fixture',hashValue:'synthetic-hash'}]:url.includes('/orders')?[]:{securitiesAccount:{positions:[{instrument:{assetType:'EQUITY',symbol:'AAPL',cusip:'fake-a'},longQuantity:10,shortQuantity:0,averagePrice:100,marketValue:1010}]}}; return new Response(JSON.stringify(body),{status:200}); } if(url.includes('api.massive.com')) { if(__smoke.chartFail) return new Response('{}',{status:500}); return new Response(JSON.stringify({status:'OK',results:[{t:Math.floor((Date.now()-120000)/60000)*60000,o:100,h:102,l:99,c:101,v:1000}]}),{status:200}); } throw Error('External network blocked'); }`)
  await send('Debugger.resume')
  paused = false
  await until(async () => evaluate(`${electron}.BrowserWindow.getAllWindows().length && !${window}.webContents.isLoading()`), Boolean, 'packaged renderer')
  const first = await until(snapshot, value => value.brokerFacts?.positions?.length === 1 && value.copilot.state === (run===1?'connected':'disconnected'), 'fake broker and bundled sidecar')
  if(run===2){await rename(binary+'.smoke-hidden',binary);hidden=false;assert.equal((await command('/copilot/restart')).status,200);await until(snapshot,value=>value.copilot.state==='connected','missing binary restored');assert.notEqual(first.runtimeInstanceId,previousRuntime)}
  assert.equal(first.positions[0].symbol, 'AAPL'); const runtime = first.runtimeInstanceId
  if(run===1){assert.equal((await command('/preparation',{content:{markdown:'Synthetic packaged premarket notes: manage AAPL patiently.',date:null,symbol:'AAPL'},expectedRevision:null})).status,200)}else{assert.equal(first.preparation.markdown,'Synthetic packaged premarket notes: manage AAPL patiently.');assert.equal(first.tickets.length,0)}
  previousRuntime=runtime
  await until(snapshot,value=>value.bookmapProjection.episodes.length===1,'Bookmap bootstrap'); assert.equal((await snapshot()).bookmapProjection.episodes[0].freshEvent,false)
  broadcast('reset');await until(snapshot,value=>value.bookmapProjection.episodes.length===0,'source reset');sourceId='fake-bookmap-'+(run+1);broadcast('heartbeat');broadcast('episode','snapshot');await until(snapshot,value=>value.bookmapProjection.sourceInstanceId===sourceId,'new source instance')
  for(const socket of sockets)socket.destroy();await until(snapshot,value=>value.bookmapProjection.episodes.length===1&&value.bookmap.state==='connected','observation reconnect');assert.equal((await snapshot()).observationAttempts.length,0)
  await evaluate(`${window}.minimize()`); await evaluate(`${window}.restore()`); await evaluate(`${window}.webContents.reload()`)
  await until(async () => evaluate(`!${window}.webContents.isLoading()`), Boolean, 'renderer reload'); assert.equal((await snapshot()).runtimeInstanceId, runtime)
  const processes = await evaluate(`${electron}.app.getAppMetrics().map(item=>({pid:item.pid,type:item.type}))`); assert.ok(processes.length >= 2)
  await writeFile(tokenFile, JSON.stringify({ schwab: { access_token: 'synthetic-two', expires_at: Date.now() + 600000 } })); assert.equal((await command('/broker/refresh')).status, 200); assert.ok((await evaluate('__smoke.tokens')).includes('Bearer synthetic-two'))
  assert.equal((await command('/chart/refresh', { symbol: 'AAPL', date: new Date().toISOString().slice(0,10) })).status, 200); await evaluate('__smoke.chartFail=true'); assert.equal((await command('/chart/refresh', { symbol: 'AAPL', date: new Date().toISOString().slice(0,10) })).status, 502); assert.equal((await snapshot()).chart.source.state, 'stale')
  // Discover only the child launched from this private package path; no unrelated runtime is touched.
  const { execFileSync } = await import('node:child_process'); const listing = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'opencode.exe' -and $_.ParentProcessId -eq ${child.pid} } | Select-Object -ExpandProperty ProcessId`], { windowsHide: true, encoding: 'utf8' }).trim(); sidecarPid = Number(listing); assert.ok(sidecarPid > 0); process.kill(sidecarPid)
  await until(snapshot, value => value.copilot.state === 'disconnected', 'sidecar loss'); assert.equal((await snapshot()).runtimeInstanceId, runtime); assert.equal((await command('/copilot/restart')).status, 200); await until(snapshot, value => value.copilot.state === 'connected', 'sidecar restart')
  await evaluate(`${window}.show()`); await new Promise(resolve=>setTimeout(resolve,300))
  await evaluate(`${window}.capturePage().then(image=>process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(path.join(packagePath, 'SMOKE-SCREENSHOT.png'))},image.toPNG()))`)
  assert.equal(await evaluate('__smoke.writes'), 0)
  await evaluate(`${electron}.app.quit()`); inspector.close(); await until(async () => child.exitCode, value => value !== null, 'clean exit')
  console.log(JSON.stringify({ build: manifest.buildId, run, packaged: true, restart: run===2, missingSidecar:run===2, rendererReload: true, minimize: true, tokenRotation: true, observationResetReconnect: true, chartFailure: true, sidecarFailureRestart: true, externalWrites: 0, cleanExit: child.exitCode }, null, 2))
  }
} finally { inspector?.close(); if (child?.exitCode === null) child.kill(); clearInterval(heartbeat);for(const socket of sockets)socket.destroy();await new Promise(resolve=>observationServer.close(resolve));await rename(path.join(packagePath,'resources/opencode/opencode.exe.smoke-hidden'),path.join(packagePath,'resources/opencode/opencode.exe')).catch(()=>{}); await new Promise(resolve => setTimeout(resolve, 300)); await rm(profile, { recursive: true, force: true }).catch(() => {}) }
