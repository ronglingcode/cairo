import { BookmapCardError } from "../shared/BookmapCardErrors.mts"
import type { BrokerFacts } from "../shared/contracts.mts"
import { OfferObservations, type OfferObservation, type OfferParameters } from "./OfferObservations.mts"

export interface EvidenceEvent { id: string; sequence: number; kind: "trade" | "bbo" | "wall-start" | "wall-update" | "wall-end" | "status"; eventTime: string; timestampFallback: boolean; price?: number; size?: number; bestBid?: number; bestAsk?: number; wallId?: string; bid?: boolean; peakSize?: number; firstTime?: string; threshold?: number; attribution?: string; buyAggressor?: boolean | null }
export interface Bounce { id: string; startTime: string; highTime: string; availableAt: string; high: number; low: number; confirmed: boolean; evidenceIds: string[] }
export interface SetupCandidate {
  id: string; revision: number; symbol: string; patternId: string | null; alternatives: string[]; wallId: string; wallPrice: number;
  breakTime: string; asOf: string; availableAt: string; beforeBounce: Bounce | null; afterBounce: Bounce | null; beforeBounces: Bounce[]; afterBounces: Bounce[];
  offerRejection: { wallId: string; price: number; touchTime: string; rejectionTime: string; evidenceIds: string[]; observationId?: string; high?: number; overshootPct?: number } | null;
  askBelow: boolean | null; askBelowSince: string | null; newObservedLow: boolean; lowCoverage: "observed-window-only";
  evidenceIds: string[]; missing: string[]; mode: string; state: "candidate" | "invalidated"; summary: string;
}
export interface EvidenceSymbol { sourceInstanceId: string; epoch: number; mode: string; readiness: string; receivedAt: string; asOf: string; tickSize: number; dropped: number; coverage: "continuous" | "warming" | "gap"; captureError: string | null; captureEnabled: boolean; events: EvidenceEvent[]; setups: SetupCandidate[]; observations: OfferObservation[] }
export interface EntrySetup { id: string; accountId: string; fillId: string; symbol: string; filledAt: string; assessment: SetupCandidate | null; detail: string }
export interface BookmapEvidenceProjection { symbols: Record<string, EvidenceSymbol>; entries: EntrySetup[]; archiveError?: string | null; parameters: { bounceTicks: number; bounceDurationMs: number; noBounceCoverageMs: number } & OfferParameters; analyses: SetupAnalysis[]; observationAnalyses: ObservationAnalysis[] }
export interface ObservationAnalysis { observationId: string; revision: number; explanation: string; evidenceIds: string[]; receivedAt: string }
export interface SetupAnalysis { setupId: string; revision: number; patternId: string | null; selectedBounceId?: string | null; explanation: string; evidenceIds: string[]; receivedAt: string }
interface Swing { low: number; high: number; start: string; highTime: string; ids: string[]; bounce: Bounce | null }
interface Wall { event: EvidenceEvent; touch: string | null; touchId: string | null; swing: Swing | null; bounces: Bounce[]; breakId: string | null; ended: boolean; rejected: SetupCandidate["offerRejection"] }
interface State { value: EvidenceSymbol; offers: OfferObservations; events: EvidenceEvent[]; walls: Map<string, Wall>; sequence: number; firstReady: number | null; lastTime: number; low: number; bestBid: number | null; bestAsk: number | null }
const ms = (ns: string) => Number(BigInt(ns) / 1_000_000n)
const patterns = ["bid-breakdown-no-bounce", "mini-bounce-then-bid-breakdown", "bid-breakdown-then-mini-bounce"]

/** Causal recognition from measurements; labels emitted by the plugin are not inputs. */
export class BookmapEvidence {
  private states = new Map<string, State>()
  private entries: EntrySetup[] = []
  private assessments: SetupCandidate[] = []
  private analyses: SetupAnalysis[] = []
  private observationAnalyses: ObservationAnalysis[] = []
  archiveError: string | null = null
  readonly parameters: BookmapEvidenceProjection["parameters"]
  restoreEntries(entries: EntrySetup[]): void {
    if(!Array.isArray(entries) || entries.length>200 || entries.some(e=>!e || [e.id,e.accountId,e.fillId,e.symbol,e.filledAt,e.detail].some(v=>typeof v!=="string"||v.length>1000) || !Number.isFinite(Date.parse(e.filledAt)) || e.assessment!==null && (!e.assessment || e.assessment.patternId!==null && !patterns.includes(e.assessment.patternId) || typeof e.assessment.breakTime!=="string"))) throw new Error("Invalid entry evidence archive")
    this.entries=structuredClone(entries)
  }
  constructor(parameters: Partial<BookmapEvidenceProjection["parameters"]> = {}) {
    this.parameters = { bounceTicks: 2, bounceDurationMs: 200, noBounceCoverageMs: 5000, offerMaxOvershootPct: 1, offerReturnMs: 5000, offerHoldBelowMs: 1000, ...parameters }
    if (Object.values(this.parameters).some(v => !Number.isFinite(v) || v <= 0)) throw new Error("Invalid Bookmap recognition parameters")
  }
  receive(raw: unknown, now: number): boolean {
    const v = raw as Record<string, any>
    if (!v || v.type !== "cairo_evidence" || v.version !== 1 || !/^[A-Z0-9.\-]{1,16}$/.test(v.symbol) || typeof v.sourceInstanceId !== "string" || v.sourceInstanceId.length > 100 || !Number.isSafeInteger(v.epoch) || v.epoch < 1 || !Number.isSafeInteger(v.watermark) || v.watermark < 0 || !Number.isSafeInteger(v.dropped) || v.dropped < 0 || v.priceUnit !== "USD" || !Number.isFinite(v.tickSize) || v.tickSize <= 0 || !["live", "replay", "unknown"].includes(v.mode) || !["ready", "not-ready"].includes(v.readiness) || !["snapshot", "stream"].includes(v.delivery) || !Array.isArray(v.events) || v.events.length > 128 || !/^\d{1,19}$/.test(v.eventTime)) return false
    // Validate the entire batch before applying any part of it.
    for (const e of v.events) {
      if (!e || typeof e.id !== "string" || e.id.length > 200 || !Number.isSafeInteger(e.sequence) || e.sequence <= 0 || e.sequence > v.watermark || !/^\d{1,19}$/.test(e.eventTime) || typeof e.timestampFallback !== "boolean" || !["trade", "bbo", "wall-start", "wall-update", "wall-end", "status"].includes(e.kind)) return false
      if (e.kind === "trade" && (!Number.isFinite(e.price) || e.price <= 0 || !Number.isFinite(e.size) || e.size <= 0)) return false
      if (e.kind === "bbo" && (![e.bestBid,e.bestAsk].every(p => Number.isFinite(p) && p > 0) || e.bestBid > e.bestAsk)) return false
      if (e.kind.startsWith("wall-") && (typeof e.wallId !== "string" || e.wallId.length > 200 || typeof e.bid !== "boolean" || !Number.isFinite(e.price) || e.price <= 0 || !Number.isFinite(e.size) || e.size < 0 || !Number.isFinite(e.peakSize) || e.peakSize < 0 || !/^\d{1,19}$/.test(e.firstTime))) return false
    }
    let state = this.states.get(v.symbol)
    if (state && state.value.sourceInstanceId === v.sourceInstanceId && v.epoch < state.value.epoch) return false
    if (!state || state.value.sourceInstanceId !== v.sourceInstanceId || state.value.epoch !== v.epoch) {
      state = { value: { sourceInstanceId:v.sourceInstanceId, epoch:v.epoch, mode:v.mode, readiness:v.readiness, receivedAt:new Date(now).toISOString(), asOf:v.eventTime, tickSize:v.tickSize, dropped:v.dropped, coverage:"warming", captureError:null, captureEnabled:Boolean(v.captureEnabled), events:[], setups:[], observations:[] }, offers:new OfferObservations(this.parameters), events:[], walls:new Map(), sequence:0, firstReady:null, lastTime:0, low:Infinity, bestBid:null, bestAsk:null }
      this.assessments=this.assessments.filter(c=>c.symbol!==v.symbol)
      this.states.set(v.symbol,state)
      while (this.states.size > 32) this.states.delete(this.states.keys().next().value!)
    }
    const s=state
    s.value.receivedAt=new Date(now).toISOString(); s.value.mode=v.mode; s.value.readiness=v.readiness; s.value.asOf=v.eventTime
    s.value.captureError=typeof v.captureError === "string" ? v.captureError.slice(0,300) : null
    if (v.dropped !== s.value.dropped) { this.gap(s); s.value.dropped=v.dropped }
    if (v.readiness !== "ready") { this.gap(s); s.value.coverage="warming" }
    for (const e of v.events as EvidenceEvent[]) {
      if (e.sequence <= s.sequence) continue
      if (s.sequence && e.sequence !== s.sequence+1 || !s.sequence && e.sequence !== 1) this.gap(s)
      const t=ms(e.eventTime)
      if (t < s.lastTime || e.timestampFallback) this.gap(s)
      s.sequence=e.sequence; s.lastTime=t
      if (v.readiness === "ready" && s.firstReady === null) s.firstReady=t
      if (s.firstReady !== null && t-s.firstReady >= this.parameters.noBounceCoverageMs) s.value.coverage="continuous"
      s.events.push(e)
      s.offers.process(v.symbol,e,s.value.tickSize,v.readiness==="ready")
      s.value.observations=s.offers.snapshot()
      this.process(s,v.symbol,e)
    }
    s.events=s.events.filter(e => ms(e.eventTime) >= s.lastTime-600_000).slice(-20_000)
    if (s.events.length === 20_000) s.value.coverage="gap"
    s.value.events=s.events.slice(-120)
    s.value.setups=s.value.setups.filter(c => ms(c.asOf) >= s.lastTime-600_000).slice(-8)
    return true
  }
  private gap(s: State): void { this.assessments=this.assessments.filter(c=>c.symbol!==s.value.setups[0]?.symbol); s.value.coverage="gap"; s.firstReady=null; s.walls.clear(); s.offers.reset(); s.value.observations=[]; s.value.setups=[]; s.bestAsk=s.bestBid=null; s.low=Infinity }
  private swing(w: Wall, e: EvidenceEvent, tick: number): Bounce | null {
    const price=e.price!
    if (!w.swing) w.swing={ low:price, high:price, start:e.eventTime, highTime:e.eventTime, ids:[e.id], bounce:null }
    const p=w.swing
    if (p.bounce?.confirmed && price < p.low) w.swing={low:price, high:price, start:e.eventTime, highTime:e.eventTime, ids:[e.id],bounce:null}
    else if (!p.bounce && price < p.low) { p.low=p.high=price; p.start=p.highTime=e.eventTime; p.ids=[e.id] }
    else {
      if (price > p.high) { p.high=price; p.highTime=e.eventTime }
      p.ids=[...p.ids,e.id].slice(-20)
      if (p.high-p.low+tick/100 >= this.parameters.bounceTicks*tick && ms(e.eventTime)-ms(p.start) >= this.parameters.bounceDurationMs) {
        p.bounce={ id:`bounce:${w.event.wallId}:${p.start}`, startTime:p.start, highTime:p.highTime, availableAt:e.eventTime, high:p.high, low:p.low, confirmed:p.high-price+tick/100>=this.parameters.bounceTicks*tick, evidenceIds:[...p.ids] }
      }
    }
    const bounce=w.swing.bounce
    if (bounce) {
      w.bounces=[...w.bounces.filter(b=>b.id!==bounce.id),structuredClone(bounce)].slice(-12)
      if (bounce.confirmed) w.swing={low:price,high:price,start:e.eventTime,highTime:e.eventTime,ids:[e.id],bounce:null}
    }
    return bounce ?? w.bounces.at(-1) ?? null
  }
  private process(s:State,symbol:string,e:EvidenceEvent): void {
    if (e.kind.startsWith("wall-")) {
      let wall=s.walls.get(e.wallId!)
      if (!wall) { wall={event:e,touch:null,touchId:null,swing:null,bounces:[],breakId:null,ended:false,rejected:null}; s.walls.set(e.wallId!,wall) }
      wall.event={...wall.event,...e}; wall.ended=e.kind==="wall-end"
      if (s.walls.size>2048) s.walls.delete(s.walls.keys().next().value!)
      return
    }
    if (e.kind==="bbo") { s.bestBid=e.bestBid!; s.bestAsk=e.bestAsk! }
    if (e.kind!=="trade" && e.kind!=="bbo") return
    const price=e.price
    const newLow=price !== undefined && price < s.low
    for (const w of s.walls.values()) {
      const wp=w.event.price!, tick=s.value.tickSize
      if (ms(e.eventTime)-ms(w.event.firstTime!)<500 || ms(e.eventTime)-ms(w.event.eventTime)>120_000) continue
      if (price !== undefined && Math.abs(price-wp)<=tick*1.01 && !w.touch && !w.ended && w.event.size! >= (w.event.threshold ?? 0)) { w.touch=e.eventTime; w.touchId=e.id }
      if (price !== undefined && !w.event.bid) {
        if(w.touch && price<=wp-this.parameters.bounceTicks*tick && ms(e.eventTime)-ms(w.touch)>=this.parameters.bounceDurationMs && !w.rejected) w.rejected={wallId:w.event.wallId!,price:wp,touchTime:w.touch,rejectionTime:e.eventTime,evidenceIds:[w.touchId!,e.id]}
        continue
      }
      if (!w.event.bid) continue
      let setup=s.value.setups.find(c=>c.id===w.breakId)
      if (!setup && price !== undefined && w.touch) {
        const bounce=this.swing(w,e,tick)
        if (price<wp-tick*0.5) {
          const before=bounce && ms(bounce.highTime)<=ms(e.eventTime) ? structuredClone(bounce) : null
          // Touch-only rejection stays distinct from the stricter clear/return/hold observation.
          const offers=[...s.walls.values()].filter(o=>o.rejected && !s.value.observations.some(observation=>observation.wallId===o.event.wallId) && ms(o.rejected.rejectionTime)<ms(e.eventTime) && ms(e.eventTime)-ms(o.rejected.rejectionTime)<120_000 && Math.abs(o.event.price!-wp)<=tick*100)
          const rejection=s.value.observations.filter(o=>o.kind==="offer-rejection" && o.state==="confirmed" && o.rejectionTime && ms(o.rejectionTime)<ms(e.eventTime) && ms(e.eventTime)-ms(o.rejectionTime)<120_000 && o.offerPrice>=wp).sort((a,b)=>ms(a.rejectionTime!)-ms(b.rejectionTime!)).at(-1)
          const offer=rejection ? {wallId:rejection.wallId,price:rejection.offerPrice,touchTime:rejection.breakoutTime,rejectionTime:rejection.rejectionTime!,evidenceIds:rejection.evidenceIds,observationId:rejection.id,high:rejection.high,overshootPct:rejection.overshootPct} : offers.sort((a,b)=>ms(b.rejected!.rejectionTime)-ms(a.rejected!.rejectionTime))[0]?.rejected ?? null
          const patternId=before ? patterns[1] : s.value.coverage==="continuous" ? patterns[0] : null
          setup={id:`setup:${w.event.wallId}:${e.sequence}`,revision:1,symbol,patternId,alternatives:[],wallId:w.event.wallId!,wallPrice:wp,breakTime:e.eventTime,asOf:e.eventTime,availableAt:e.eventTime,beforeBounce:before,afterBounce:null,beforeBounces:structuredClone(w.bounces),afterBounces:[],offerRejection:offer,askBelow:s.bestAsk===null?null:s.bestAsk<wp,askBelowSince:s.bestAsk!==null&&s.bestAsk<wp?e.eventTime:null,newObservedLow:newLow,lowCoverage:"observed-window-only",evidenceIds:[w.event.id,w.touchId!,e.id],missing:[],mode:s.value.mode,state:"candidate",summary:""}
          w.breakId=setup.id; w.bounces=[]; w.swing={low:price,high:price,start:e.eventTime,highTime:e.eventTime,ids:[e.id],bounce:null}; s.value.setups.push(setup)
        }
      } else if (setup) {
        const prior=JSON.stringify([setup.patternId,setup.afterBounce?.high,setup.afterBounce?.confirmed,setup.askBelow,setup.state])
        if (price !== undefined) {
          const bounce=this.swing(w,e,tick)
          if (bounce) { setup.afterBounce=structuredClone(bounce); setup.afterBounces=structuredClone(w.bounces); setup.patternId=patterns[2]; if(setup.beforeBounce) setup.alternatives=[patterns[1]] }
          setup.newObservedLow=newLow
        }
        if(s.bestAsk!==null) { setup.askBelow=s.bestAsk<wp; if(!setup.askBelow) setup.askBelowSince=null; else if(!setup.askBelowSince) setup.askBelowSince=e.eventTime }
        if(s.bestBid!==null && s.bestBid>=wp) setup.state="invalidated"
        setup.asOf=e.eventTime
        if(JSON.stringify([setup.patternId,setup.afterBounce?.high,setup.afterBounce?.confirmed,setup.askBelow,setup.state])!==prior) setup.revision++
      }
      if(setup) {
        setup.missing=[]
        if(s.value.coverage!=="continuous") setup.missing.push("Incomplete pre-break coverage; no-bounce cannot be established")
        if(setup.askBelow===null) setup.missing.push("Best ask unavailable")
        if(setup.afterBounce && !setup.afterBounce.confirmed) setup.missing.push("Post-break bounce high is provisional")
        if(setup.beforeBounce && setup.afterBounce) setup.missing.push("Bounces on both sides; entry timing determines the setup")
        setup.summary=`${setup.patternId?.replaceAll("-"," ") ?? "bid breakdown; bounce history unknown"} · wall $${wp.toFixed(Math.max(2,Math.ceil(-Math.log10(tick))))}${setup.offerRejection ? ` · prior offer rejection $${setup.offerRejection.price.toFixed(Math.max(2,Math.ceil(-Math.log10(tick))))}` : ""}`
        this.assessments.push(structuredClone(setup)); this.assessments=this.assessments.slice(-4000)
      }
    }
    if(price!==undefined) s.low=Math.min(s.low,price)
  }
  timeline(symbol:string,start?:string,end?:string): { status:EvidenceSymbol; events:EvidenceEvent[] } {
    const s=this.states.get(symbol); if(!s) throw new Error("No recorded evidence for this symbol")
    if(start && !/^\d{1,19}$/.test(start) || end && !/^\d{1,19}$/.test(end)) throw new Error("Timeline times must be nanosecond strings")
    return structuredClone({status:s.value,events:s.events.filter(e=>(!start || BigInt(e.eventTime)>=BigInt(start))&&(!end || BigInt(e.eventTime)<=BigInt(end))).slice(-2000)})
  }
  associate(facts:BrokerFacts): void {
    for(const fill of facts.recentFills) {
      if(fill.side!=="sell" || !facts.positions.some(p=>p.symbol===fill.symbol&&p.side==="short"&&p.quantity>0) || this.entries.some(e=>e.accountId===facts.accountId&&e.fillId===fill.fillId)) continue
      const state=this.states.get(fill.symbol)
      // Replay market time is not broker live time. Never attach replay context to a real fill.
      if(!state || state.value.mode!=="live") continue
      const at=Date.parse(fill.filledAt)
      const candidate=this.assessments.filter(c=>c.symbol===fill.symbol&&c.mode==="live"&&ms(c.availableAt)<=at&&ms(c.asOf)<=at&&at-ms(c.asOf)<10_000).at(-1)
      this.entries.push({id:`${facts.accountId}:${fill.fillId}`,accountId:facts.accountId,fillId:fill.fillId,symbol:fill.symbol,filledAt:fill.filledAt,assessment:candidate?structuredClone(candidate):null,detail:candidate?"Frozen evidence at first observed fill; sell execution associated with current short position; separate adds retain separate fills":"Entry-time evidence unavailable"})
    }
    this.entries=this.entries.slice(-200)
  }
  analyse(value: Omit<SetupAnalysis,"receivedAt">, now:number): void {
    const setup=[...this.states.values()].flatMap(s=>s.value.setups).find(c=>c.id===value.setupId)
    if(!setup || setup.revision!==value.revision) throw new BookmapCardError("setup-changed")
    if(value.patternId!==null && !patterns.includes(value.patternId) || typeof value.explanation!=="string" || value.explanation.length>2000 || !Array.isArray(value.evidenceIds) || !value.evidenceIds.length || value.evidenceIds.length>30) throw new BookmapCardError("invalid-setup")
    const state=this.states.get(setup.symbol)!
    if(value.evidenceIds.some(id=>!state.events.some(e=>e.id===id))) throw new BookmapCardError("missing-evidence")
    if (value.selectedBounceId && ![...setup.beforeBounces,...setup.afterBounces].some(b=>b.id===value.selectedBounceId)) throw new BookmapCardError("unknown-bounce")
    if (value.patternId===patterns[1] && !setup.beforeBounces.length || value.patternId===patterns[2] && !setup.afterBounces.length || value.patternId===patterns[0] && (setup.beforeBounces.length || state.value.coverage!=="continuous")) throw new BookmapCardError("unsupported-pattern")
    const supported=new Set(state.events.flatMap(e=>[e.price,e.bestBid,e.bestAsk]).filter((p):p is number=>p!==undefined))
    for (const match of value.explanation.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)) if (![...supported].some(p=>Math.abs(p-Number(match[1]))<state.value.tickSize/100)) throw new BookmapCardError("unmeasured-price")
    this.analyses=[...this.analyses.filter(a=>a.setupId!==value.setupId),{...value,receivedAt:new Date(now).toISOString()}].slice(-100)
  }
  analyseObservation(value: Omit<ObservationAnalysis,"receivedAt">, now:number): void {
    const state=[...this.states.values()].find(s=>s.value.observations.some(o=>o.id===value.observationId))
    const observation=state?.value.observations.find(o=>o.id===value.observationId)
    if (!state || !observation || observation.revision!==value.revision) throw new BookmapCardError("observation-changed")
    if (typeof value.explanation!=="string" || !value.explanation.trim() || value.explanation.length>2000 || !Array.isArray(value.evidenceIds) || !value.evidenceIds.length || value.evidenceIds.length>30) throw new BookmapCardError("invalid-observation")
    if (value.evidenceIds.some(id=>!observation.evidenceIds.includes(id) || !state.events.some(e=>e.id===id))) throw new BookmapCardError("missing-observation-evidence")
    const prices=[observation.offerPrice, observation.high, observation.overshoot, ...state.events.flatMap(e=>[e.price,e.bestBid,e.bestAsk]).filter((p):p is number=>p!==undefined)]
    for (const match of value.explanation.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)) if (!prices.some(p=>Math.abs(p-Number(match[1]))<state.value.tickSize/100)) throw new BookmapCardError("unmeasured-price")
    this.observationAnalyses=[...this.observationAnalyses.filter(a=>a.observationId!==value.observationId),{...value,receivedAt:new Date(now).toISOString()}].slice(-100)
  }
  snapshot(): BookmapEvidenceProjection { return structuredClone({symbols:Object.fromEntries([...this.states].map(([k,s])=>[k,s.value])),entries:this.entries,archiveError:this.archiveError,parameters:this.parameters,analyses:this.analyses,observationAnalyses:this.observationAnalyses}) }
  reset():void { this.states.clear(); this.analyses=[]; this.observationAnalyses=[]; this.assessments=[] }
}
