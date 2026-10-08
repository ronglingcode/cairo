import { PATTERN_MEANINGS } from '../src/engine/BookmapEvidence.mts'
export const ns = ms => (BigInt(ms)*1_000_000n).toString()
export function aggregate(now,changes={}) {
 const symbol=typeof changes.symbol==='object'?changes.symbol.canonical:changes.symbol??'AAPL'
 const pattern=changes.pattern??'BID_REAPPEAR',bid=pattern.startsWith('BID')||pattern==='UNKNOWN_BID_LOSS'
 const event={id:changes.episodeId??'e1',revision:changes.revision??1,type:pattern,side:bid?'BID':'OFFER',meaning:PATTERN_MEANINGS[pattern],interactionId:'wall',episodeKey:'episode',price:changes.price??100,size:8000,sizeBasis:'DISPLAYED_WALL',eventTime:changes.eventTime??ns(now),observedAt:changes.eventTime??ns(now),timestampProvenance:'MARKET',evidence:{wallPhaseId:'wall',previousSize:8000,currentSize:0,removedSize:8000,attributedTradeSize:8000,growthBaselineSize:0,approachTimeNs:'0',rejectionTimeNs:'0',attribution:'PROBABLE_CONSUMPTION',coverage:'USABLE',metadata:{},buyAggressor:!bid}}
 const reset=changes.kind==='reset'
 return {type:'cairo_patterns',version:1,sourceInstanceId:'source-1',symbol,epoch:reset?2:1,sequence:1,eventTime:ns(now),priceUnit:'USD',tickSize:.01,mode:'live',readiness:reset?'not-ready':'ready',coverage:reset?'warming':'continuous',delivery:'stream',configRevision:'c1',detectorRevision:'composer-patterns-v1',patterns:changes.kind==='heartbeat'||reset?[]:[event],signals:[],contexts:[],candidateStates:{},liquidity:{threshold:5000,asOf:ns(now),bestBid:99.99,bestAsk:100,bids:[],offers:[]},...changes,symbol,delivery:changes.delivery==='live'?'stream':changes.delivery??'stream'}
}
export const wire=(now,changes={})=>JSON.stringify(aggregate(now,changes))
export function composed(now,changes={}) {
 const a=aggregate(now,{pattern:'BID_BREAKDOWN',...changes})
 const event=a.patterns[0]
 a.signals=[{id:'s1',revision:1,direction:'SHORT',triggerId:event.id,interactionId:event.interactionId,pattern:event.type,price:event.price,size:event.size,state:'VALID',eventTime:ns(now),observedAt:ns(now),stateAt:ns(now),explanation:'Confirmed bid breakdown at $100.00',confirmationStrength:'NONE',normalTriggerThreshold:6000,appliedTriggerThreshold:6000,evidenceIds:[event.id]}]
 return a
}
