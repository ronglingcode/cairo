import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { CairoEngine } from '../src/engine/CairoEngine.mts'
import { BookmapReceiver } from '../src/engine/BookmapReceiver.mts'
import { CairoDomainTools } from '../src/copilot/CairoDomainTools.mts'
import { resolve } from 'node:path'

const child=spawn(process.execPath,['scripts/replay-bookmap-evidence.mjs','--file',resolve('../bookmap-plugin/build/fixtures/cairo-evidence.jsonl'),'--port','18765','--speed','1000'],{windowsHide:true,stdio:['ignore','pipe','pipe']})
const engine=new CairoEngine(),receiver=new BookmapReceiver(engine)
try {
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('Replay server failed to start')}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Replay startup timeout')),5000))])
  receiver.start('ws://127.0.0.1:18765')
  for(let i=0;i<100&&!engine.getSnapshot().bookmapEvidence.symbols.PCVX?.setups.length;i++) await new Promise(r=>setTimeout(r,50))
  const setup=engine.getSnapshot().bookmapEvidence.symbols.PCVX?.setups.at(-1)
  assert.ok(setup,'No setup from the actual Java producer');assert.equal(setup.patternId,'mini-bounce-then-bid-breakdown');assert.equal(setup.beforeBounce.high,10.24);assert.equal(setup.offerRejection.price,10.3)
  const tools=new CairoDomainTools(engine,async()=>true);tools.setBookmapEvidence(receiver.evidence)
  const timeline=await tools.execute('read_bookmap_timeline',{symbol:'PCVX'},'verification')
  assert.equal(timeline.events.length,9)
  await tools.execute('interpret_bookmap_setup',{setupId:setup.id,revision:setup.revision,patternId:setup.patternId,selectedBounceId:setup.beforeBounce.id,explanation:'Mini bounce high $10.24 before bid breakdown; prior offer rejection at $10.30.',evidenceIds:setup.beforeBounce.evidenceIds},'verification')
  assert.equal(engine.getSnapshot().bookmapEvidence.analyses.length,1);assert.equal(engine.getSnapshot().tickets.length,0)
  console.log('PASS: real Java producer -> replay WebSocket -> Cairo timeline -> independent recognition -> validated AI-card contract. No orders.')
} finally {receiver.stop();child.kill();await once(child,'exit').catch(()=>{})}
