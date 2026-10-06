import type { EvidenceEvent } from "./BookmapEvidence.mts"

export interface OfferObservation {
  id: string; revision: number; symbol: string; wallId: string; offerPrice: number; peakSize: number;
  kind: "large-offer-breakout" | "offer-rejection";
  state: "observing" | "confirmed" | "extended" | "expired" | "reclaimed";
  breakoutTime: string; high: number; highTime: string; returnTime: string | null; rejectionTime: string | null;
  overshoot: number; overshootPct: number; asOf: string; evidenceIds: string[];
}
export interface OfferParameters { offerMaxOvershootPct: number; offerReturnMs: number; offerHoldBelowMs: number }
interface OfferWall { event: EvidenceEvent; ended: boolean; touchId: string | null; observation: OfferObservation | null }
const ms = (time: string) => Number(BigInt(time) / 1_000_000n)

/** Observation only: crossing an observed offer does not prove that its orders were consumed. */
export class OfferObservations {
  private walls = new Map<string, OfferWall>()
  private observations: OfferObservation[] = []
  private lastTrade: number | null = null
  private parameters: OfferParameters
  constructor(parameters: OfferParameters) { this.parameters=parameters }
  reset(): void { this.walls.clear(); this.observations=[]; this.lastTrade=null }
  snapshot(): OfferObservation[] { return structuredClone(this.observations) }
  process(symbol: string, e: EvidenceEvent, tick: number, ready: boolean): void {
    if (!ready) { this.reset(); return }
    if (e.kind.startsWith("wall-") && !e.bid) {
      const prior=this.walls.get(e.wallId!)
      // A retained offer is already qualified by the producer's size threshold.
      if (prior) { prior.event={...prior.event,...e}; prior.ended=e.kind==="wall-end" }
      else if (e.kind!=="wall-end" && e.size! >= (e.threshold ?? 1)) this.walls.set(e.wallId!,{event:e,ended:false,touchId:null,observation:null})
      if (this.walls.size>2048) this.walls.delete(this.walls.keys().next().value!)
    }
    for (const wall of this.walls.values()) {
      const level=wall.event.price!, time=ms(e.eventTime)
      const price=e.kind==="trade" ? e.price! : null
      if (wall.observation && ["expired","extended","reclaimed"].includes(wall.observation.state) &&
          price!==null && price>=level+tick*0.99 && this.lastTrade!==null && this.lastTrade<=level &&
          !wall.ended && wall.event.size! >= (wall.event.threshold ?? 1)) {
        // A replenished/still-large offer can have a later independent crossing attempt.
        wall.observation=null; wall.touchId=null
      }
      if (price!==null && !wall.observation && !wall.ended && Math.abs(price-level)<=tick*1.01) wall.touchId=e.id
      if (!wall.observation && price!==null && time-ms(wall.event.firstTime!)>=500 &&
          price>=level+tick*0.99 && (wall.touchId || this.lastTrade!==null && this.lastTrade<=level) &&
          (!wall.ended || time-ms(wall.event.eventTime)<=this.parameters.offerReturnMs)) {
        const observation: OfferObservation={id:`offer:${wall.event.wallId}:${e.sequence}`,revision:1,symbol,wallId:wall.event.wallId!,offerPrice:level,peakSize:wall.event.peakSize!,kind:"large-offer-breakout",state:"observing",breakoutTime:e.eventTime,high:price,highTime:e.eventTime,returnTime:null,rejectionTime:null,overshoot:price-level,overshootPct:100*(price-level)/level,asOf:e.eventTime,evidenceIds:[wall.event.id,...(wall.touchId?[wall.touchId]:[]),e.id]}
        wall.observation=observation; this.observations.push(observation)
      }
      const o=wall.observation
      if (!o || o.state==="expired" || o.state==="extended" || o.state==="reclaimed") continue
      const before=JSON.stringify(o)
      if (price!==null && price>o.high) { o.high=price; o.highTime=e.eventTime; o.overshoot=price-level; o.overshootPct=100*o.overshoot/level; o.evidenceIds=[...o.evidenceIds,e.id].slice(-30) }
      const above=price!==null && price>=level || e.kind==="bbo" && e.bestBid!>=level
      const below=price!==null && price<level-tick*0.5 || e.kind==="bbo" && e.bestAsk!<level-tick*0.5
      if (o.state==="confirmed") {
        if (above) { o.state="reclaimed"; o.asOf=e.eventTime; o.evidenceIds=[...o.evidenceIds,e.id].slice(-30) }
      } else if (o.overshootPct>this.parameters.offerMaxOvershootPct+1e-8) { o.state="extended"; o.asOf=e.eventTime }
      else {
        if ((above || e.kind==="bbo" && !below) && o.returnTime) { o.returnTime=null; o.asOf=e.eventTime; o.evidenceIds=[...o.evidenceIds,e.id].slice(-30) }
        if (below && !o.returnTime && time-ms(o.breakoutTime)<=this.parameters.offerReturnMs) { o.returnTime=e.eventTime; o.asOf=e.eventTime; o.evidenceIds=[...o.evidenceIds,e.id].slice(-30) }
        // Require a later below-price/quote measurement, rather than heartbeat silence.
        if (below && o.returnTime && time-ms(o.returnTime)>=this.parameters.offerHoldBelowMs) { o.kind="offer-rejection"; o.state="confirmed"; o.rejectionTime=o.asOf=e.eventTime; o.evidenceIds=[...o.evidenceIds,e.id].slice(-30) }
        else if (!o.returnTime && time-ms(o.breakoutTime)>this.parameters.offerReturnMs) { o.state="expired"; o.asOf=e.eventTime }
      }
      if (JSON.stringify(o)!==before) o.revision++
    }
    if (e.kind==="trade") this.lastTrade=e.price!
    this.observations=this.observations.filter(o=>ms(o.asOf)>=ms(e.eventTime)-600_000).slice(-32)
    for (const [id,wall] of this.walls) if (ms(wall.event.eventTime)<ms(e.eventTime)-600_000) this.walls.delete(id)
  }
}
