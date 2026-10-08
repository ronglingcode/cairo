import { BookmapCardError } from "../shared/BookmapCardErrors.mts"
import type { BrokerFacts } from "../shared/contracts.mts"

export const PATTERN_MEANINGS = {
  BID_BOUNCE: "BID_HOLD", BID_REAPPEAR: "BID_HOLD", BID_STEP_UP: "BID_HOLD",
  BIDS_CANCELLED: "BID_FAIL", BID_BREAKDOWN: "BID_FAIL",
  OFFER_REAPPEAR: "OFFER_BEARISH_CONFIRMATION", OFFER_STEP_DOWN: "OFFER_BEARISH_CONFIRMATION",
  OFFER_BOUNCE: "OFFER_BEARISH_CONFIRMATION", OFFER_SIZE_INCREASING_HOLD: "OFFER_BEARISH_CONFIRMATION",
  OFFER_BREAKOUT: "OFFER_BULLISH_CONFIRMATION", OFFER_SIZE_INCREASE: "UNKNOWN",
  UNKNOWN_BID_LOSS: "UNKNOWN", UNKNOWN_OFFER_LOSS: "UNKNOWN",
} as const
export type PatternType = keyof typeof PATTERN_MEANINGS
export interface PatternObservation {
  id: string; revision: number; type: PatternType; side: "BID" | "OFFER"; meaning: string;
  interactionId: string; episodeKey: string; price: number; size: number; sizeBasis: string;
  eventTime: string; observedAt: string; timestampProvenance: "MARKET" | "FALLBACK";
  evidence: { wallPhaseId: string; previousSize: number; currentSize: number; removedSize: number;
    attributedTradeSize: number; growthBaselineSize: number; approachTimeNs: string; rejectionTimeNs: string;
    attribution: string; coverage: string; metadata: Record<string,string>; buyAggressor?: boolean | null };
  symbol: string; kind: PatternType; state: "recorded"; evidenceIds: string[];
}
export type EvidenceEvent = PatternObservation
export interface PluginSignal {
  id: string; revision: number; direction: "LONG" | "SHORT"; triggerId: string; interactionId: string;
  pattern: PatternType; price: number; size: number; state: "CANDIDATE" | "VALID" | "INVALID" | "EXPIRED";
  eventTime: string; observedAt: string; stateAt: string; explanation: string; confirmationStrength: string;
  normalTriggerThreshold: number; appliedTriggerThreshold: number; evidenceIds: string[];
}
export interface PluginContext { direction: "LONG" | "SHORT"; confirmationId: string; strength: string; waitingFor: string; requiredTriggerSize: number; expiresAt: string }
export interface SetupCandidate {
  id: string; revision: number; symbol: string; patternId: string; direction: "long" | "short";
  wallId: string; wallPrice: number; breakTime: string; asOf: string; availableAt: string;
  evidenceIds: string[]; missing: string[]; mode: string; state: "candidate" | "invalidated"; summary: string;
}
interface Liquidity { threshold: number; asOf: string; bestBid: number; bestAsk: number; bids: {price:number;displayedSize:number}[]; offers: {price:number;displayedSize:number}[] }
export interface EvidenceSymbol {
  sourceInstanceId: string; epoch: number; sequence: number; mode: string; readiness: string; receivedAt: string;
  asOf: string; tickSize: number; coverage: "continuous" | "warming" | "gap"; configRevision: string; detectorRevision: string; rules: Record<string, unknown>;
  captureError: string | null; captureEnabled: boolean; events: PatternObservation[]; observations: PatternObservation[];
  signals: PluginSignal[]; contexts: PluginContext[]; candidateStates: Record<string,string>; setups: SetupCandidate[]; liquidity: Liquidity;
}
export interface EntrySetup { id: string; accountId: string; fillId: string; symbol: string; filledAt: string; assessment: SetupCandidate | null; detail: string }
export interface ObservationAnalysis { observationId: string; revision: number; explanation: string; evidenceIds: string[]; receivedAt: string }
export interface SetupAnalysis { setupId: string; revision: number; patternId: string | null; explanation: string; evidenceIds: string[]; receivedAt: string }
export interface BookmapEvidenceProjection { symbols: Record<string,EvidenceSymbol>; entries: EntrySetup[]; archiveError?: string | null; parameters: { source: "bookmap-plugin" }; analyses: SetupAnalysis[]; observationAnalyses: ObservationAnalysis[] }
const nano = (v: unknown): v is string => typeof v === "string" && /^\d{1,19}$/.test(v)
const text = (v: unknown, max=300): v is string => typeof v === "string" && v.length > 0 && v.length <= max
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0
const quantity = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0
const ms = (ns: string) => Number(BigInt(ns) / 1_000_000n)
const type = (v: unknown): v is PatternType => typeof v === "string" && Object.hasOwn(PATTERN_MEANINGS,v)
const state = (v: unknown) => ["CANDIDATE","VALID","INVALID","EXPIRED"].includes(v as string)

/** Consumer of plugin-owned aggregates. No raw order flow or pattern detection lives in Cairo. */
export class BookmapEvidence {
  private states = new Map<string,EvidenceSymbol>()
  private entries: EntrySetup[] = []
  private retiredSources = new Set<string>()
  private seenSignals = new Set<string>()
  private assessments: SetupCandidate[] = []
  private analyses: SetupAnalysis[] = []
  private observationAnalyses: ObservationAnalysis[] = []
  archiveError: string | null = null
  readonly parameters = { source: "bookmap-plugin" as const }
  restoreEntries(entries: EntrySetup[]): void {
    // Historical archives stay readable; their former classifications are never live inputs.
    if (!Array.isArray(entries) || entries.length>200 || entries.some(e=>!e || [e.id,e.accountId,e.fillId,e.symbol,e.filledAt,e.detail].some(v=>typeof v!=="string"||v.length>1000) || !Number.isFinite(Date.parse(e.filledAt)) || e.assessment!==null && (!e.assessment || !nano(e.assessment.breakTime)))) throw new Error("Invalid entry evidence archive")
    this.entries=structuredClone(entries)
  }
  receive(raw: unknown, now: number): boolean {
    const v=raw as Record<string,any>
    if (!v || v.type!=="cairo_patterns" || v.version!==1 || !text(v.symbol,16) || !/^[A-Z0-9.\-]{1,16}$/.test(v.symbol) || !text(v.sourceInstanceId,100) || !Number.isSafeInteger(v.epoch) || v.epoch<1 || !Number.isSafeInteger(v.sequence) || v.sequence<1 || !nano(v.eventTime) || !positive(v.tickSize) || v.priceUnit!=="USD" || !["live","replay","unknown"].includes(v.mode) || !["ready","not-ready"].includes(v.readiness) || !["continuous","warming","gap"].includes(v.coverage) || !["stream","snapshot"].includes(v.delivery) || !text(v.configRevision) || !text(v.detectorRevision) || !Array.isArray(v.patterns) || v.patterns.length>64 || !Array.isArray(v.signals) || v.signals.length>32 || !Array.isArray(v.contexts) || v.contexts.length>2) return false
    if (v.readiness!=="ready" && v.coverage==="continuous") return false
    const ids=new Set<string>()
    for (const e of v.patterns) {
      if (!e || !text(e.id) || ids.has(e.id) || !Number.isSafeInteger(e.revision) || e.revision<1 || !type(e.type) || e.meaning!==PATTERN_MEANINGS[e.type as PatternType] || e.side!==(e.type.startsWith("BID")||e.type==="UNKNOWN_BID_LOSS"?"BID":"OFFER") || !text(e.interactionId) || !text(e.episodeKey) || !positive(e.price) || !quantity(e.size) || e.size===0 || !["DISPLAYED_WALL","DISPLAYED_REMOVED"].includes(e.sizeBasis) || !nano(e.eventTime) || !nano(e.observedAt) || BigInt(e.eventTime)>BigInt(e.observedAt) || BigInt(e.observedAt)>BigInt(v.eventTime) || !["MARKET","FALLBACK"].includes(e.timestampProvenance)) return false
      const ev=e.evidence
      if (!ev || typeof ev.wallPhaseId!=="string" || ev.wallPhaseId.length>300 || ![ev.previousSize,ev.currentSize,ev.removedSize,ev.attributedTradeSize,ev.growthBaselineSize].every(quantity) || !nano(ev.approachTimeNs) || !nano(ev.rejectionTimeNs) || !["UNKNOWN","INFERRED_WITHDRAWAL","PROBABLE_CONSUMPTION","PROBABLE_MOVE"].includes(ev.attribution) || !["USABLE","WARMUP","GAP"].includes(ev.coverage) || !ev.metadata || typeof ev.metadata!=="object" || Array.isArray(ev.metadata) || Object.keys(ev.metadata).length>32 || Object.entries(ev.metadata).some(([k,x])=>k.length>100 || typeof x!=="string" || x.length>500) || ev.buyAggressor!==undefined && ev.buyAggressor!==null && typeof ev.buyAggressor!=="boolean") return false
      ids.add(e.id)
    }
    const signalIds=new Set<string>()
    for (const s of v.signals) {
      if (!s || !text(s.id) || signalIds.has(s.id) || !Number.isSafeInteger(s.revision) || s.revision<1 || !["LONG","SHORT"].includes(s.direction) || !ids.has(s.triggerId) || !text(s.interactionId) || !type(s.pattern) || !positive(s.price) || !quantity(s.size) || s.size===0 || !state(s.state) || !nano(s.stateAt) || BigInt(s.stateAt)>BigInt(v.eventTime) || !nano(s.eventTime) || !nano(s.observedAt) || BigInt(s.eventTime)>BigInt(s.observedAt) || BigInt(s.observedAt)>BigInt(v.eventTime) || !text(s.explanation,8000) || !text(s.confirmationStrength,30) || !positive(s.normalTriggerThreshold) || !positive(s.appliedTriggerThreshold) || s.appliedTriggerThreshold>s.normalTriggerThreshold || !Array.isArray(s.evidenceIds) || !s.evidenceIds.length || s.evidenceIds.length>64 || s.evidenceIds.some((id:unknown)=>!ids.has(id as string))) return false
      const trigger=v.patterns.find((e:PatternObservation)=>e.id===s.triggerId)
      if (trigger.type!==s.pattern || trigger.interactionId!==s.interactionId || trigger.price!==s.price || trigger.meaning!==(s.direction==="LONG"?"BID_HOLD":"BID_FAIL")) return false
      signalIds.add(s.id)
    }
    for (const c of v.contexts) if (!c || !["LONG","SHORT"].includes(c.direction) || !ids.has(c.confirmationId) || !text(c.strength,30) || c.waitingFor!==(c.direction==="LONG"?"BID_HOLD":"BID_FAIL") || !positive(c.requiredTriggerSize) || !nano(c.expiresAt)) return false
    if (!v.candidateStates || typeof v.candidateStates!=="object" || Array.isArray(v.candidateStates) || Object.keys(v.candidateStates).length>128 || Object.entries(v.candidateStates).some(([id,s])=>!text(id)||!state(s))) return false
    const l=v.liquidity
    if (!l || !positive(l.threshold) || !nano(l.asOf) || !quantity(l.bestBid) && !positive(l.bestBid) || !quantity(l.bestAsk) && !positive(l.bestAsk) || l.bestBid>0 && l.bestAsk>0 && l.bestBid>l.bestAsk || !Array.isArray(l.bids) || !Array.isArray(l.offers) || l.bids.length>8 || l.offers.length>8 || [...l.bids,...l.offers].some(e=>!e||!positive(e.price)||!quantity(e.displayedSize)||e.displayedSize<l.threshold)) return false
    if (Object.keys(v).some(k=>["events","trades","depth","wallUpdates"].includes(k))) return false
    const prior=this.states.get(v.symbol)
    if (this.retiredSources.has(`${v.symbol}:${v.sourceInstanceId}`)) return false
    if (prior?.sourceInstanceId===v.sourceInstanceId && (v.epoch<prior.epoch || v.epoch===prior.epoch && (v.sequence<=prior.sequence || BigInt(v.eventTime)<BigInt(prior.asOf)))) return false
    if (prior?.sourceInstanceId===v.sourceInstanceId && prior.epoch===v.epoch && (v.patterns.some((e:PatternObservation)=>prior.observations.some(p=>p.id===e.id&&p.revision>e.revision)) || v.signals.some((e:PluginSignal)=>prior.signals.some(p=>p.id===e.id&&p.revision>e.revision)))) return false
    if (prior && prior.sourceInstanceId!==v.sourceInstanceId) { this.retiredSources.add(`${v.symbol}:${prior.sourceInstanceId}`); while(this.retiredSources.size>128)this.retiredSources.delete(this.retiredSources.values().next().value!) }
    if (prior && (prior.sourceInstanceId!==v.sourceInstanceId || prior.epoch!==v.epoch)) { this.assessments=this.assessments.filter(c=>c.symbol!==v.symbol); this.analyses=this.analyses.filter(a=>!prior.setups.some(c=>c.id===a.setupId)); this.observationAnalyses=this.observationAnalyses.filter(a=>!prior.observations.some(o=>o.id===a.observationId)) }
    const observations:PatternObservation[]=v.patterns.map((e:PatternObservation)=>({...e,symbol:v.symbol,kind:e.type,state:"recorded",evidenceIds:[e.id]}))
    const setups:SetupCandidate[]=v.signals.map((s:PluginSignal)=>({id:s.id,revision:s.revision,symbol:v.symbol,patternId:s.pattern,direction:s.direction==="LONG"?"long":"short",wallId:s.triggerId,wallPrice:s.price,breakTime:s.eventTime,asOf:BigInt(s.stateAt)>BigInt(s.observedAt)?s.stateAt:s.observedAt,availableAt:BigInt(s.stateAt)>BigInt(s.observedAt)?s.stateAt:s.observedAt,evidenceIds:s.evidenceIds,missing:[],mode:v.mode,state:s.state==="VALID"?"candidate":"invalidated",summary:s.explanation}))
    const value:EvidenceSymbol={sourceInstanceId:v.sourceInstanceId,epoch:v.epoch,sequence:v.sequence,mode:v.mode,readiness:v.readiness,receivedAt:new Date(now).toISOString(),asOf:v.eventTime,tickSize:v.tickSize,coverage:v.coverage,configRevision:v.configRevision,detectorRevision:v.detectorRevision,rules:structuredClone(v.rules??{}),captureError:typeof v.captureError==="string"?v.captureError.slice(0,300):null,captureEnabled:v.captureEnabled===true,events:observations,observations,signals:structuredClone(v.signals),contexts:structuredClone(v.contexts),candidateStates:structuredClone(v.candidateStates),setups,liquidity:structuredClone(l)}
    this.states.set(v.symbol,value)
    // Full snapshots can recover skipped deliveries without treating receipt time as market time.
    if (v.delivery==="stream" && v.mode==="live" && v.readiness==="ready" && v.coverage==="continuous") {
      for (const c of setups) if (!this.seenSignals.has(`${v.sourceInstanceId}:${v.epoch}:${c.id}:${c.revision}:${c.state}:${c.asOf}`)) this.assessments.push(structuredClone(c))
      this.assessments=this.assessments.slice(-4000)
    } else this.assessments=this.assessments.filter(c=>c.symbol!==v.symbol)
    for (const c of setups) this.seenSignals.add(`${v.sourceInstanceId}:${v.epoch}:${c.id}:${c.revision}:${c.state}:${c.asOf}`)
    while(this.seenSignals.size>4096)this.seenSignals.delete(this.seenSignals.values().next().value!)
    while (this.states.size>32) { const symbol=this.states.keys().next().value!; this.states.delete(symbol); this.assessments=this.assessments.filter(c=>c.symbol!==symbol) }
    return true
  }
  targetLiquidity(symbol:string, side:"long"|"short", now:number) {
    const s=this.states.get(symbol)
    if (!s) return {available:false,reason:"No Bookmap aggregate liquidity",levels:[]}
    const age=now-Date.parse(s.receivedAt), marketAge=now-ms(s.asOf), liquidityAge=now-ms(s.liquidity.asOf)
    const available=s.mode==="live"&&s.readiness==="ready"&&s.coverage==="continuous"&&age>=0&&age<=10_000&&marketAge>=0&&marketAge<=10_000&&liquidityAge>=0&&liquidityAge<=10_000&&s.liquidity.bestBid>0&&s.liquidity.bestAsk>0
    const referencePrice=side==="long"?s.liquidity.bestAsk:s.liquidity.bestBid
    const levels=available?(side==="long"?s.liquidity.offers:s.liquidity.bids).filter(l=>side==="long"?l.price>=referencePrice:l.price<=referencePrice).map(l=>({wallId:`${s.sourceInstanceId}:${s.epoch}:${side}:${l.price}`,evidenceId:null,price:l.price,displayedSize:l.displayedSize,largeOrderThreshold:s.liquidity.threshold,thresholdMultiple:l.displayedSize/s.liquidity.threshold,updatedAt:s.liquidity.asOf})):[]
    return {available,reason:available?null:"Bookmap aggregate must be fresh, live, ready and continuous",mode:s.mode,coverage:s.coverage,receivedAt:s.receivedAt,asOf:s.asOf,referencePrice,tickSize:s.tickSize,levels,coverageScope:"Plugin aggregate of up to eight large displayed levels per side"}
  }
  timeline(symbol:string,start?:string,end?:string):{status:EvidenceSymbol;events:PatternObservation[]} {
    const s=this.states.get(symbol); if(!s) throw new Error("No plugin pattern aggregate for this symbol")
    if(start&&!nano(start)||end&&!nano(end)) throw new Error("Timeline times must be nanosecond strings")
    return structuredClone({status:s,events:s.events.filter(e=>(!start||BigInt(e.eventTime)>=BigInt(start))&&(!end||BigInt(e.eventTime)<=BigInt(end)))})
  }
  associate(facts:BrokerFacts):void {
    for(const fill of facts.recentFills) {
      const direction=fill.side==="buy"?"long":"short"
      if(!facts.positions.some(p=>p.symbol===fill.symbol&&p.side===direction&&p.quantity>0)||this.entries.some(e=>e.accountId===facts.accountId&&e.fillId===fill.fillId)) continue
      const s=this.states.get(fill.symbol); if(!s||s.mode!=="live"||s.readiness!=="ready"||s.coverage!=="continuous") continue
      const at=Date.parse(fill.filledAt)
      const assessment=this.assessments.filter(c=>c.symbol===fill.symbol&&c.direction===direction&&ms(c.availableAt)<=at&&at-ms(c.asOf)<10_000).sort((a,b)=>ms(a.availableAt)-ms(b.availableAt)).at(-1)
      const candidate=assessment?.state==="candidate"?assessment:null
      this.entries.push({id:`${facts.accountId}:${fill.fillId}`,accountId:facts.accountId,fillId:fill.fillId,symbol:fill.symbol,filledAt:fill.filledAt,assessment:candidate?structuredClone(candidate):null,detail:candidate?"Frozen plugin composition available at the fill":"Entry-time plugin composition unavailable"})
    }
    this.entries=this.entries.slice(-200)
  }
  private annotation(explanation:string,ids:string[],allowed:string[],s:EvidenceSymbol):void {
    if(typeof explanation!=="string"||!explanation.trim()||explanation.length>2000||!Array.isArray(ids)||!ids.length||ids.length>30) throw new BookmapCardError("invalid-observation")
    if(ids.some(id=>!allowed.includes(id)||!s.events.some(e=>e.id===id))) throw new BookmapCardError("missing-evidence")
    const prices=s.events.filter(e=>ids.includes(e.id)).map(e=>e.price)
    for(const match of explanation.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)) if(!prices.some(p=>Math.abs(p-Number(match[1]))<s.tickSize/100)) throw new BookmapCardError("unmeasured-price")
  }
  analyse(value:Omit<SetupAnalysis,"receivedAt">,now:number):void {
    const s=[...this.states.values()].find(s=>s.setups.some(c=>c.id===value.setupId)), setup=s?.setups.find(c=>c.id===value.setupId)
    if(!s||!setup||setup.revision!==value.revision) throw new BookmapCardError("setup-changed")
    if(value.patternId!==setup.patternId) throw new BookmapCardError("unsupported-pattern")
    this.annotation(value.explanation,value.evidenceIds,setup.evidenceIds,s)
    this.analyses=[...this.analyses.filter(a=>a.setupId!==value.setupId),{...value,receivedAt:new Date(now).toISOString()}].slice(-100)
  }
  analyseObservation(value:Omit<ObservationAnalysis,"receivedAt">,now:number):void {
    const s=[...this.states.values()].find(s=>s.observations.some(o=>o.id===value.observationId)), observation=s?.observations.find(o=>o.id===value.observationId)
    if(!s||!observation||observation.revision!==value.revision) throw new BookmapCardError("observation-changed")
    this.annotation(value.explanation,value.evidenceIds,observation.evidenceIds,s)
    this.observationAnalyses=[...this.observationAnalyses.filter(a=>a.observationId!==value.observationId),{...value,receivedAt:new Date(now).toISOString()}].slice(-100)
  }
  snapshot():BookmapEvidenceProjection {return structuredClone({symbols:Object.fromEntries(this.states),entries:this.entries,archiveError:this.archiveError,parameters:this.parameters,analyses:this.analyses,observationAnalyses:this.observationAnalyses})}
  reset():void {this.states.clear();this.retiredSources.clear();this.seenSignals.clear();this.analyses=[];this.observationAnalyses=[];this.assessments=[]}
}
