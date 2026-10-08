import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BookmapEvidence } from '../src/engine/BookmapEvidence.mts'
import { BookmapEntryArchive } from '../src/engine/BookmapEntryArchive.mts'
import { CairoEngine } from '../src/engine/CairoEngine.mts'
import { CairoDomainTools } from '../src/copilot/CairoDomainTools.mts'
import { aggregate,composed,ns } from './bookmap-aggregate-fixture.mjs'
const now=Date.parse('2026-10-07T14:00:00Z')
function facts(side='short',at=now){return {accountId:'a',recentFills:[{fillId:'f',symbol:'AAPL',side:side==='short'?'sell':'buy',filledAt:new Date(at).toISOString()}],positions:[{symbol:'AAPL',side,quantity:1}]}}
test('raw order flow and old observation protocol cannot create patterns',()=>{
 const e=new BookmapEvidence();for(const type of ['cairo_evidence','cairo_observation'])assert.equal(e.receive({...aggregate(now),type,events:[{kind:'trade',price:99}]},now),false)
 assert.deepEqual(e.snapshot().symbols,{})
})
test('all canonical events are consumed, offer break is only confirmation context',()=>{
 const e=new BookmapEvidence(),a=aggregate(now,{pattern:'OFFER_BREAKOUT'})
 a.contexts=[{direction:'LONG',confirmationId:'e1',strength:'STRONG',waitingFor:'BID_HOLD',requiredTriggerSize:4000,expiresAt:ns(now+10000)}]
 assert.equal(e.receive(a,now),true);assert.equal(e.snapshot().symbols.AAPL.observations[0].type,'OFFER_BREAKOUT');assert.equal(e.snapshot().symbols.AAPL.setups.length,0);assert.equal(e.snapshot().symbols.AAPL.contexts.length,1)
 const engine=new CairoEngine(),tools=new CairoDomainTools(engine,async()=>true);engine.updateSnapshot({bookmapEvidence:e.snapshot()});tools.setBookmapEvidence(e);assert.equal(engine.getSnapshot().tickets.length,0)
})
test('composed signals are copied from plugin with validation thresholds and state',()=>{
 const e=new BookmapEvidence(),a=composed(now);assert.equal(e.receive(a,now),true)
 assert.equal(e.snapshot().symbols.AAPL.setups[0].patternId,'BID_BREAKDOWN');assert.equal(e.snapshot().symbols.AAPL.signals[0].appliedTriggerThreshold,6000)
 a.sequence=2;a.signals[0].state='EXPIRED';assert.equal(e.receive(a,now),true);assert.equal(e.snapshot().symbols.AAPL.setups[0].state,'invalidated')
})
test('full snapshots recover skipped sequences but reject duplicates, prior epochs and backwards time',()=>{
 const e=new BookmapEvidence(),a=aggregate(now);assert.equal(e.receive(a,now),true);assert.equal(e.receive(a,now),false)
 assert.equal(e.receive({...a,sequence:10},now),true)
 assert.equal(e.receive({...a,epoch:2,sequence:1,patterns:[],signals:[],readiness:'not-ready',coverage:'warming'},now),true)
 assert.equal(e.receive({...a,sequence:11},now),false);assert.equal(e.snapshot().symbols.AAPL.observations.length,0)
 assert.equal(e.receive({...a,epoch:2,sequence:2,eventTime:ns(now-1)},now),false)
})
test('whole invalid aggregate is rejected without mutating the current projection',()=>{
 const e=new BookmapEvidence(),a=composed(now);e.receive(a,now)
 for(const mutate of [v=>v.patterns[0].meaning='UNKNOWN',v=>v.patterns[0].size=-1,v=>v.signals[0].triggerId='missing',v=>v.signals[0].direction='LONG',v=>v.contexts=[{direction:'LONG',confirmationId:'missing'}],v=>v.liquidity.offers=[{price:100,displayedSize:1}]]){const b=structuredClone(a);b.sequence=2;mutate(b);assert.equal(e.receive(b,now),false)}
 assert.equal(e.snapshot().symbols.AAPL.sequence,1)
})
test('AI annotates recorded IDs and prices but cannot create bounce variants or reclassify',()=>{
 const e=new BookmapEvidence();e.receive(composed(now),now)
 const v={setupId:'s1',revision:1,patternId:'BID_BREAKDOWN',explanation:'Confirmed bid breakdown at $100.00.',evidenceIds:['e1']};e.analyse(v,now)
 assert.throws(()=>e.analyse({...v,patternId:'mini-bounce-then-bid-breakdown'},now),/supporting structure/)
 assert.throws(()=>e.analyse({...v,revision:2},now),/changed/);assert.throws(()=>e.analyse({...v,evidenceIds:['trade1']},now),/missing/)
 assert.throws(()=>e.analyse({...v,explanation:'Wall at $101.00'},now),/unmeasured/)
 e.analyseObservation({observationId:'e1',revision:1,explanation:'Wall at $100.00',evidenceIds:['e1']},now)
 assert.equal(e.snapshot().analyses.length,1);assert.equal(e.snapshot().observationAnalyses.length,1)
})
test('entry archive freezes only causal live compositions and retains them across reset',async()=>{
 const e=new BookmapEvidence();e.receive(composed(now),now);e.associate(facts('short',now+1));assert.equal(e.snapshot().entries[0].assessment.patternId,'BID_BREAKDOWN')
 const a=composed(now+2);a.sequence=2;a.signals[0].revision=2;a.signals[0].explanation='Later revision';e.receive(a,now+2);e.associate(facts('short',now+3));assert.equal(e.snapshot().entries[0].assessment.revision,1)
 const root=await mkdtemp(path.join(tmpdir(),'cairo-aggregate-'));try{const archive=new BookmapEntryArchive(root,e);await archive.load();archive.capture();await archive.flush();const restored=new BookmapEvidence();await new BookmapEntryArchive(root,restored).load();assert.equal(restored.snapshot().entries[0].assessment.patternId,'BID_BREAKDOWN')}finally{await rm(root,{recursive:true,force:true})}
 e.reset();assert.equal(e.snapshot().entries.length,1)
})
test('replay, reconnect history and future revisions cannot attach to a live fill',()=>{
 for(const changes of [{mode:'replay'},{delivery:'snapshot'}]){const e=new BookmapEvidence();e.receive(composed(now,changes),now);e.associate(facts());assert.equal(e.snapshot().entries[0]?.assessment??null,null)}
 const e=new BookmapEvidence();e.receive(composed(now+100),now+100);e.associate(facts('short',now));assert.equal(e.snapshot().entries[0].assessment,null)
})
test('long entry association uses plugin long composition without local detection',()=>{
 const e=new BookmapEvidence(),a=composed(now,{pattern:'BID_BOUNCE'});a.signals[0].direction='LONG';assert.equal(e.receive(a,now),true);e.associate(facts('long',now+1));assert.equal(e.snapshot().entries[0].assessment.direction,'long')
})

test('snapshot history never becomes live fill evidence on a following heartbeat',()=>{
 const e=new BookmapEvidence(),a=composed(now,{delivery:'snapshot'});e.receive(a,now);e.receive({...a,delivery:'stream',sequence:2},now);e.associate(facts('short',now+1));assert.equal(e.snapshot().entries[0].assessment,null)
})
test('plugin invalidation before a fill prevents freezing the earlier valid state',()=>{
 const e=new BookmapEvidence(),a=composed(now);e.receive(a,now);a.sequence=2;a.eventTime=ns(now+5);a.signals[0].stateAt=ns(now+5);a.signals[0].revision=2;a.signals[0].state='INVALID';e.receive(a,now+5);e.associate(facts('short',now+6));assert.equal(e.snapshot().entries[0].assessment,null)
})
test('replaced chart sources and decreasing event revisions are rejected',()=>{
 const e=new BookmapEvidence(),a=aggregate(now);e.receive(a,now);e.receive({...a,sourceInstanceId:'new'},now);assert.equal(e.receive({...a,sequence:3},now),false)
 const b=aggregate(now,{sourceInstanceId:'new',sequence:2,revision:2});assert.equal(e.receive(b,now),true);assert.equal(e.receive({...a,sourceInstanceId:'new',sequence:3},now),false)
})
