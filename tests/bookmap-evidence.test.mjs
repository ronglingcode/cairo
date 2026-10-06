import test from 'node:test'
import assert from 'node:assert/strict'
import { BookmapEvidence } from '../src/engine/BookmapEvidence.mts'
import { CairoEngine } from '../src/engine/CairoEngine.mts'
import { BookmapReceiver } from '../src/engine/BookmapReceiver.mts'
import { CairoDomainTools } from '../src/copilot/CairoDomainTools.mts'
import { CopilotWaker } from '../src/copilot/CopilotWaker.mts'
import { BookmapEntryArchive } from '../src/engine/BookmapEntryArchive.mts'
import { BookmapPatterns } from '../src/engine/BookmapPatterns.mts'
import { EngineApiServer } from '../src/engine/EngineApiServer.mts'
import { positionEngine } from './fixtures/positions.mjs'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const base=Date.parse('2026-10-05T14:00:00Z')
const ns=t=>String(BigInt(base+t)*1_000_000n)
function fixture(variant='before', mode='replay') {
  let sequence=0
  const events=[]
  const add=(kind,t,fields={})=>events.push({id:`e${++sequence}`,sequence,kind,eventTime:ns(t),timestampFallback:false,...fields})
  const wall=(id,bid,price)=>({wallId:id,bid,price,size:10000,peakSize:10000,firstTime:ns(0),threshold:5000,attribution:'unknown'})
  add('wall-start',0,wall('bid',true,10.2)); add('wall-start',0,wall('offer',false,10.3))
  add('trade',5800,{price:10.3,size:100}); add('trade',6000,{price:10.25,size:100})
  add('trade',6100,{price:10.2,size:100})
  if(variant==='before'||variant==='both') add('trade',6500,{price:10.24,size:100})
  add('bbo',6800,{bestBid:10.18,bestAsk:10.19})
  add('trade',7000,{price:10.18,size:100})
  if(variant==='after'||variant==='both') {add('trade',7100,{price:10.15,size:100});add('trade',7500,{price:10.18,size:100});add('trade',7800,{price:10.15,size:100})}
  const batch={type:'cairo_evidence',version:1,sourceInstanceId:'s1',epoch:1,symbol:'PCVX',priceUnit:'USD',tickSize:0.01,mode,readiness:'ready',delivery:'stream',watermark:sequence,dropped:0,captureEnabled:false,eventTime:events.at(-1).eventTime,events}
  return {batch,add,events}
}
test('independent recognition distinguishes three sequences and offer rejection',()=>{
  for(const [variant,pattern] of [['before','mini-bounce-then-bid-breakdown'],['after','bid-breakdown-then-mini-bounce'],['none','bid-breakdown-no-bounce']]) {
    const evidence=new BookmapEvidence(); const {batch}=fixture(variant)
    assert.equal(evidence.receive(batch,base+10000),true)
    const setup=evidence.snapshot().symbols.PCVX.setups.at(-1)
    assert.equal(setup.patternId,pattern); assert.equal(setup.offerRejection.price,10.3); assert.equal(setup.askBelow,true)
    if(variant==='before') assert.equal(setup.beforeBounce.high,10.24)
    if(variant==='after') {assert.equal(setup.afterBounce.high,10.18);assert.equal(setup.afterBounce.confirmed,true)}
  }
})
test('both bounces retain alternatives; late history cannot prove no bounce',()=>{
  const evidence=new BookmapEvidence(); const {batch}=fixture('both'); evidence.receive(batch,base)
  const c=evidence.snapshot().symbols.PCVX.setups.at(-1)
  assert.ok(c.beforeBounce);assert.ok(c.afterBounce);assert.deepEqual(c.alternatives,['mini-bounce-then-bid-breakdown'])
  const late=new BookmapEvidence(); const f=fixture('none').batch; f.events=f.events.slice(-3); f.events[0]={...f.events[0],kind:'wall-start',...{wallId:'bid',bid:true,price:10.2,size:10000,peakSize:10000,firstTime:ns(0)}}
  late.receive(f,base); assert.notEqual(late.snapshot().symbols.PCVX.coverage,'continuous')
})
test('multiple pre-break bounces retain measured identities for AI selection',()=>{
  const f=fixture('before');const at=f.events.findIndex(e=>e.kind==='bbo')
  f.events.splice(at,0,{kind:'trade',eventTime:ns(6600),price:10.21,size:100,timestampFallback:false},{kind:'trade',eventTime:ns(6900),price:10.23,size:100,timestampFallback:false})
  f.events.sort((a,b)=>Number(BigInt(a.eventTime)-BigInt(b.eventTime)))
  f.events.forEach((e,i)=>{e.id=`e${i+1}`;e.sequence=i+1});f.batch.watermark=f.events.length
  const evidence=new BookmapEvidence();evidence.receive(f.batch,base)
  const c=evidence.snapshot().symbols.PCVX.setups.at(-1)
  assert.equal(c.beforeBounces.length,2);assert.equal(c.beforeBounces[0].high,10.24);assert.equal(c.beforeBounces[1].high,10.23)
  evidence.analyse({setupId:c.id,revision:c.revision,patternId:c.patternId,selectedBounceId:c.beforeBounces[0].id,explanation:'Earlier bounce high $10.24.',evidenceIds:c.beforeBounces[0].evidenceIds},base)
  assert.equal(evidence.snapshot().analyses[0].selectedBounceId,c.beforeBounces[0].id)
})
test('malformed batch is atomic; gaps and resets clear recognition; duplicate snapshots do not trigger',()=>{
  const evidence=new BookmapEvidence(); const {batch}=fixture()
  const bad=structuredClone(batch);bad.events.at(-1).price=-1;assert.equal(evidence.receive(bad,base),false);assert.equal(Object.keys(evidence.snapshot().symbols).length,0)
  evidence.receive(batch,base);const count=evidence.snapshot().symbols.PCVX.events.length
  evidence.receive({...batch,delivery:'snapshot'},base);assert.equal(evidence.snapshot().symbols.PCVX.events.length,count)
  evidence.receive({...batch,events:[{id:'gap',sequence:batch.watermark+2,kind:'status',eventTime:ns(8000),timestampFallback:false}],watermark:batch.watermark+2,eventTime:ns(8000)},base)
  assert.equal(evidence.snapshot().symbols.PCVX.setups.length,0)
  evidence.receive({...batch,epoch:2,events:[],watermark:0,readiness:'not-ready'},base);assert.equal(evidence.snapshot().symbols.PCVX.readiness,'not-ready')
})
test('entry assessment is frozen at execution time; replay never attaches to broker fills',()=>{
  const evidence=new BookmapEvidence();const {batch}=fixture('both','live');evidence.receive(batch,base+10000)
  const facts={accountId:'account',positions:[{symbol:'PCVX',side:'short',quantity:10}],recentFills:[{fillId:'f',symbol:'PCVX',side:'sell',filledAt:new Date(base+7050).toISOString()}]}
  evidence.associate(facts)
  assert.equal(evidence.snapshot().entries[0].assessment.patternId,'mini-bounce-then-bid-breakdown')
  const replay=new BookmapEvidence();replay.receive({...batch,mode:'replay'},base);replay.associate(facts);assert.equal(replay.snapshot().entries.length,0)
})
test('frozen entry archive survives restart and preserves a corrupt existing file',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'cairo-entry-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const evidence=new BookmapEvidence();evidence.receive(fixture('both','live').batch,base)
  evidence.associate({accountId:'a',positions:[{symbol:'PCVX',side:'short',quantity:10}],recentFills:[{fillId:'f',symbol:'PCVX',side:'sell',filledAt:new Date(base+7050).toISOString()}]})
  const archive=new BookmapEntryArchive(root,evidence);await archive.load();archive.capture();await archive.flush()
  const restored=new BookmapEvidence();await new BookmapEntryArchive(root,restored).load();assert.equal(restored.snapshot().entries[0].assessment.beforeBounce.high,10.24)
  const file=path.join(root,'bookmap-entry-evidence.json');await writeFile(file,'broken')
  const bad=new BookmapEntryArchive(root,restored);await bad.load();bad.capture();await bad.flush();assert.equal(await readFile(file,'utf8'),'broken');assert.match(restored.archiveError,/preserved/)
})
test('receiver -> tools -> validated AI card -> automatic replay explanation',async()=>{
  const engine=new CairoEngine();const receiver=new BookmapReceiver(engine,()=>base+10000)
  assert.equal(receiver.receive(JSON.stringify(fixture().batch)),true)
  assert.equal(engine.getSnapshot().bookmap.state,'connected')
  const domain=new CairoDomainTools(engine,async()=>true,()=>base+10000);domain.setBookmapEvidence(receiver.evidence)
  const data=await domain.execute('read_bookmap_timeline',{symbol:'PCVX'},'session')
  const setup=data.status.setups[0]
  const input={setupId:setup.id,revision:setup.revision,patternId:setup.patternId,explanation:'Measured bounce high $10.24 before the break; prior offer rejection.',evidenceIds:setup.beforeBounce.evidenceIds}
  await domain.execute('interpret_bookmap_setup',input,'session');assert.equal(engine.getSnapshot().bookmapEvidence.analyses.length,1)
  await assert.rejects(domain.execute('interpret_bookmap_setup',{...input,evidenceIds:['fabricated']},'session'),/missing evidence/)
  await assert.rejects(domain.execute('interpret_bookmap_setup',{...input,explanation:'Bounce high $9999'},'session'),/unmeasured price/)
  await assert.rejects(domain.execute('interpret_bookmap_setup',{...input,revision:99},'session'),/changed/)
  const calls=[];const chat={snapshot:{connected:true,busy:false,outcome:null},notify:async t=>calls.push(t)}
  const waker=new CopilotWaker(engine,chat,()=>base+10000);waker.cycle();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.match(calls[0],/interpret_bookmap_setup/)
  waker.cycle();assert.equal(calls.length,1);assert.equal(engine.getSnapshot().tickets.length,0)
})
test('accepting a live suggestion confirms the existing trade tag; replay and stale revisions reject',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'cairo-accept-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const directory=path.join(root,'bookmap_patterns');await mkdir(directory)
  await writeFile(path.join(directory,'activePatterns.md'),'## Short\n| ID | Pattern | Tradebook |\n| --- | --- | --- |\n| mini-bounce-then-bid-breakdown | mini bounce then bid breakdown | — |\n')
  const engine=positionEngine();const facts=engine.getSnapshot().brokerFacts;facts.positions=[{...facts.positions[0],symbol:'PCVX',side:'short'}];facts.asOf=new Date(base+10000).toISOString();engine.updateSnapshot({brokerFacts:facts,positions:facts.positions})
  const patterns=new BookmapPatterns(engine,root,root,()=>base+10000);await patterns.load();t.after(()=>patterns.stop())
  const receiver=new BookmapReceiver(engine,()=>base+10000);t.after(()=>receiver.stop());receiver.receive(JSON.stringify(fixture('before','replay').batch))
  let setup=engine.getSnapshot().bookmapEvidence.symbols.PCVX.setups[0]
  await assert.rejects(patterns.acceptSetup({setupId:setup.id,revision:setup.revision,positionId:'position-0'}),/replaying/)
  receiver.receive(JSON.stringify({...fixture('before','live').batch,sourceInstanceId:'live-source'}));receiver.tick();setup=engine.getSnapshot().bookmapEvidence.symbols.PCVX.setups[0]
  await assert.rejects(patterns.acceptSetup({setupId:setup.id,revision:99,positionId:'position-0'}),/changed/)
  await patterns.acceptSetup({setupId:setup.id,revision:setup.revision,positionId:'position-0'})
  assert.equal((await patterns.read('position-0')).pattern.id,'mini-bounce-then-bid-breakdown');assert.equal(engine.getSnapshot().tickets.length,0)
})

function offerFixture(trades, overrides={}) {
  let sequence=0
  const events=[{kind:'wall-start',time:0,wallId:'large-offer',bid:false,price:90,size:10000,peakSize:10000,firstTime:ns(0),threshold:5000},...trades.map(([time,price])=>({kind:'trade',time,price,size:100}))].map(({time,...e})=>({...e,id:`offer-e${++sequence}`,sequence,eventTime:ns(time),timestampFallback:false}))
  return {type:'cairo_evidence',version:1,sourceInstanceId:'offer-source',epoch:1,symbol:'PCVX',priceUnit:'USD',tickSize:0.01,mode:'replay',readiness:'ready',delivery:'stream',watermark:sequence,dropped:0,captureEnabled:false,eventTime:events.at(-1).eventTime,events,...overrides}
}

test('offer breakout is observation only; small pop, quick return and measured hold confirm rejection',()=>{
  const evidence=new BookmapEvidence()
  const batch=offerFixture([[600,89.99],[800,90.05],[1200,90.8],[1600,89.98]])
  evidence.receive(batch,base)
  let status=evidence.snapshot().symbols.PCVX
  assert.equal(status.setups.length,0);assert.equal(status.observations.length,1)
  let o=status.observations[0]
  assert.equal(o.kind,'large-offer-breakout');assert.equal(o.state,'observing');assert.equal(o.high,90.8)
  assert.equal(o.returnTime,ns(1600));assert.ok(o.overshootPct<1)
  const event={kind:'trade',price:89.9,size:100,id:'offer-hold',sequence:batch.watermark+1,eventTime:ns(2600),timestampFallback:false}
  evidence.receive({...batch,events:[event],watermark:event.sequence,eventTime:event.eventTime},base+1000)
  o=evidence.snapshot().symbols.PCVX.observations[0]
  assert.equal(o.kind,'offer-rejection');assert.equal(o.state,'confirmed');assert.equal(o.rejectionTime,ns(2600))
  assert.equal(evidence.snapshot().symbols.PCVX.setups.length,0)
  const reclaim={...event,id:'reclaim',sequence:event.sequence+1,eventTime:ns(2700),price:90.1}
  evidence.receive({...batch,events:[reclaim],watermark:reclaim.sequence,eventTime:reclaim.eventTime},base+1100)
  assert.equal(evidence.snapshot().symbols.PCVX.observations[0].state,'reclaimed')
})

test('large pop, slow return, touch-only and recrossing do not confirm the requested offer rejection',()=>{
  const scenarios=[
    [[[600,89.99],[800,90.05],[1000,91],[1200,89.9],[2400,89.8]],'extended'],
    [[[600,89.99],[800,90.05],[6000,89.9],[7500,89.8]],'expired'],
    [[[600,89.99],[800,90.05],[1000,89.9],[1500,90.1],[1800,89.9],[2400,89.8]],'observing'],
  ]
  for (const [trades,state] of scenarios) {const e=new BookmapEvidence();e.receive(offerFixture(trades),base);assert.equal(e.snapshot().symbols.PCVX.observations[0].state,state)}
  const touch=new BookmapEvidence();touch.receive(offerFixture([[600,90],[1800,89.5]]),base);assert.equal(touch.snapshot().symbols.PCVX.observations.length,0)
  const unready=new BookmapEvidence();unready.receive(offerFixture([[600,89.99],[800,90.05]],{readiness:'not-ready'}),base);assert.equal(unready.snapshot().symbols.PCVX.observations.length,0)
})

test('confirmed cleared-offer rejection is linked causally to later bid setup and clears on gaps/seek',()=>{
  const batch=offerFixture([[600,89.99],[800,90.05],[1000,90.6],[1400,89.99],[2500,89.95]])
  batch.events.push({kind:'wall-start',eventTime:ns(2600),id:'bid-start',sequence:++batch.watermark,timestampFallback:false,wallId:'bid-confirmed',bid:true,price:89.5,size:10000,peakSize:10000,firstTime:ns(2600),threshold:5000})
  for (const [time,price] of [[3200,89.5],[3500,89.45]]) batch.events.push({kind:'trade',eventTime:ns(time),id:`bid-${time}`,sequence:++batch.watermark,timestampFallback:false,price,size:100})
  batch.eventTime=ns(3500)
  const evidence=new BookmapEvidence();evidence.receive(batch,base)
  const status=evidence.snapshot().symbols.PCVX
  assert.equal(status.setups[0].offerRejection.observationId,status.observations[0].id)
  assert.equal(status.setups[0].offerRejection.high,90.6)
  const gap={kind:'status',eventTime:ns(3600),id:'offer-gap',sequence:batch.watermark+2,timestampFallback:false}
  evidence.receive({...batch,events:[gap],watermark:gap.sequence,eventTime:gap.eventTime},base)
  assert.equal(evidence.snapshot().symbols.PCVX.observations.length,0)
  evidence.receive({...batch,epoch:2,events:[],watermark:0,eventTime:ns(0)},base)
  assert.equal(evidence.snapshot().symbols.PCVX.observations.length,0)
})

test('offer-only observations wake AI, coalesce ticks, and validate observation explanations',async()=>{
  let now=base+10000
  const engine=new CairoEngine();const receiver=new BookmapReceiver(engine,()=>now)
  const batch=offerFixture([[600,89.99],[800,90.05],[1000,90.6]])
  receiver.receive(JSON.stringify(batch));receiver.tick()
  const domain=new CairoDomainTools(engine,async()=>true,()=>now);domain.setBookmapEvidence(receiver.evidence)
  const data=await domain.execute('read_setup_candidates',{symbol:'PCVX'},'session')
  const o=data.status.observations[0];assert.equal(data.status.setups.length,0)
  const input={observationId:o.id,revision:o.revision,explanation:'Observed offer $90.00 crossed; high $90.60, a $0.60 overshoot. Awaiting return.',evidenceIds:o.evidenceIds}
  await domain.execute('interpret_bookmap_observation',input,'session')
  assert.equal(engine.getSnapshot().bookmapEvidence.observationAnalyses.length,1)
  assert.equal((await domain.execute('read_context',{},'session')).bookmapEvidence.observationAnalyses.length,1)
  await assert.rejects(domain.execute('interpret_bookmap_observation',{...input,evidenceIds:['invented']},'session'),/missing observation evidence/)
  await assert.rejects(domain.execute('interpret_bookmap_observation',{...input,revision:999},'session'),/changed/)
  await assert.rejects(domain.execute('interpret_bookmap_observation',{...input,explanation:'High $999'},'session'),/unmeasured/)
  await assert.rejects(domain.execute('interpret_bookmap_observation',{...input,explanation:'Overshoot $0.61'},'session'),/unmeasured/)
  const calls=[];const chat={snapshot:{connected:true,busy:false,outcome:null},notify:async text=>calls.push(text)}
  const waker=new CopilotWaker(engine,chat,()=>now);waker.cycle();await new Promise(r=>setImmediate(r))
  assert.equal(calls.length,1);assert.match(calls[0],/interpret_bookmap_observation/)
  assert.doesNotMatch(calls[0],/Latest account summary|Assess meaningful account|"accountId"/)
  assert.match(calls[0],/Current local observation explanations/)
  const higher={kind:'trade',eventTime:ns(1100),id:'offer-higher',sequence:batch.watermark+1,timestampFallback:false,price:90.7,size:100}
  receiver.receive(JSON.stringify({...batch,events:[higher],watermark:higher.sequence,eventTime:higher.eventTime}));receiver.tick()
  now+=3100;waker.cycle();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1)
  const events=[[1400,89.99],[2500,89.95]].map(([t,price],i)=>({kind:'trade',eventTime:ns(t),id:`offer-confirm-${i}`,sequence:higher.sequence+i+1,timestampFallback:false,price,size:100}))
  receiver.receive(JSON.stringify({...batch,events,watermark:events.at(-1).sequence,eventTime:events.at(-1).eventTime}));receiver.tick()
  waker.cycle();await new Promise(r=>setImmediate(r));assert.equal(calls.length,2)
  assert.equal(engine.getSnapshot().tickets.length,0)
  receiver.stop()
})

test('a later crossing of a still-large offer creates a separate observation after a failed attempt',()=>{
  const evidence=new BookmapEvidence()
  evidence.receive(offerFixture([[600,89.99],[800,90.05],[6000,89.9],[7000,90.1],[7500,89.9],[8600,89.8]]),base)
  const observations=evidence.snapshot().symbols.PCVX.observations
  assert.equal(observations.length,2);assert.equal(observations[0].state,'expired')
  assert.equal(observations[1].kind,'offer-rejection');assert.equal(observations[1].state,'confirmed')
  assert.notEqual(observations[0].id,observations[1].id)
})

test('card update API reports safe validation errors and hides unexpected internal errors',async t=>{
  const engine=new CairoEngine();const receiver=new BookmapReceiver(engine,()=>base)
  receiver.receive(JSON.stringify(offerFixture([[600,89.99],[800,90.14]])));receiver.tick()
  const domain=new CairoDomainTools(engine,async()=>true,()=>base);domain.setBookmapEvidence(receiver.evidence)
  const api=new EngineApiServer(engine);api.setDomainTools(domain);const url=await api.start()
  t.after(async()=>{receiver.stop();await api.stop()})
  const o=engine.getSnapshot().bookmapEvidence.symbols.PCVX.observations[0]
  const input={observationId:o.id,revision:o.revision,explanation:'Offer $90 crossed; high $90.14 is a $0.14 overshoot.',evidenceIds:o.evidenceIds}
  const call=value=>fetch(`${url}/copilot/tools`,{method:'POST',headers:{Authorization:`Bearer ${api.toolToken}`,'Content-Type':'application/json'},body:JSON.stringify({operation:'interpret_bookmap_observation',input:value,sessionId:'session'})})
  assert.equal((await call(input)).status,200)
  const bad=await call({...input,explanation:'Overshoot $999'})
  assert.equal(bad.status,400);assert.deepEqual(await bad.json(),{code:'unmeasured-price',error:'Interpretation contains an unmeasured price or distance'})
  const stale=await call({...input,revision:999})
  assert.equal((await stale.json()).code,'observation-changed')
  api.setDomainTools({execute:async()=>{throw new Error('private-provider-secret')}})
  const unexpected=await call(input)
  assert.equal(unexpected.status,400);assert.ok(!JSON.stringify(await unexpected.json()).includes('private-provider-secret'))
})
