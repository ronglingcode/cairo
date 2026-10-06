import { useState } from "react"
import type { CairoSnapshot } from "../shared/contracts.mts"

function AiExplanation({text}:{text:string}) {
  return text.length<=200
    ? <p className="bookmap-ai"><strong>AI:</strong> {text}</p>
    : <details className="bookmap-ai"><summary>AI explanation</summary><p>{text}</p></details>
}

export function BookmapSetupCards({snapshot}:{snapshot:CairoSnapshot|null}) {
  const [error,setError]=useState<string|null>(null), [pending,setPending]=useState(false)
  async function command(route:string,body:unknown) {
    setPending(true); setError(null)
    try {
      const response=await fetch(`${window.cairo?.apiBaseUrl}${route}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${window.cairo?.commandToken}`},body:JSON.stringify(body)})
      const value=await response.json(); if(!response.ok) throw new Error(value.error ?? "Request failed")
    } catch(e) { setError(e instanceof Error?e.message:"Request failed") } finally { setPending(false) }
  }
  if(!snapshot || !Object.keys(snapshot.bookmapEvidence.symbols).length) return null
  const price=(p:number,tick:number)=>p.toFixed(Math.max(2,Math.ceil(-Math.log10(tick))))
  const time=(ns:string)=>new Date(Number(BigInt(ns)/1_000_000n)).toLocaleTimeString()
  return <section className="bookmap-setups" aria-label="Recognized Bookmap setups">
    <div className="bookmap-heading"><strong>Bookmap assistant</strong>
    <label><input type="checkbox" checked={snapshot.copilotWake.bookmapEnabled} disabled={pending} onChange={e=>void command("/bookmap/ai",{enabled:e.target.checked})} /> Auto AI</label></div>
    {Object.entries(snapshot.bookmapEvidence.symbols).map(([symbol,status])=><div key={symbol}>
      <p className="bookmap-feed"><strong>{symbol}</strong> · {status.mode} · {Date.now()-Date.parse(status.receivedAt)>6000?"Feed stale":status.readiness!=="ready"?"Depth warming":"Receiving"}{status.coverage!=="continuous"?" · Incomplete history":""}</p>
      {status.captureError && <p role="alert">{status.captureError}</p>}
      <details className="bookmap-feed-details"><summary>Feed &amp; filters</summary>
        <p>{status.readiness} · {status.coverage} history · market time {time(status.asOf)} · {status.events.length} recent events · {status.setups.length} setups · {status.observations.length} observations</p>
        <p>Rejection: pop ≤ {snapshot.bookmapEvidence.parameters.offerMaxOvershootPct}%, return within {snapshot.bookmapEvidence.parameters.offerReturnMs/1000}s, hold below {snapshot.bookmapEvidence.parameters.offerHoldBelowMs/1000}s.</p>
      </details>
      {status.observations.slice(-4).reverse().map(observation=>{
        const analysis=snapshot.bookmapEvidence.observationAnalyses.find(a=>a.observationId===observation.id&&a.revision===observation.revision)
        const elapsed=(from:string,to:string)=>((Number(BigInt(to)-BigInt(from)))/1_000_000_000).toFixed(2)
        return <article className="bookmap-setup" key={observation.id}>
          <p className="bookmap-result"><strong>{observation.state==="confirmed"?"Offer rejection confirmed":observation.state==="reclaimed"?"Offer reclaimed":observation.state==="extended"?"Breakout · pop too large":observation.state==="expired"?"Breakout · rejection unconfirmed":"Offer breakout · watching return"}</strong><span className="bookmap-context-label">Confirmation only</span></p>
          <p className="bookmap-metrics">Offer ${price(observation.offerPrice,status.tickSize)} · High ${price(observation.high,status.tickSize)} · Pop {observation.overshootPct.toFixed(2)}%{observation.returnTime?` · Return ${elapsed(observation.breakoutTime,observation.returnTime)}s`:""}{observation.rejectionTime?` · Hold ${elapsed(observation.returnTime!,observation.rejectionTime)}s`:""}</p>
          {analysis && <AiExplanation text={analysis.explanation} />}
          <button disabled={pending||snapshot.copilotChat?.busy} onClick={()=>void command("/copilot/send",{commandId:crypto.randomUUID(),text:`Explain Bookmap offer observation ${observation.id} for ${symbol}. Read cairo.read_setup_candidates and cairo.read_bookmap_timeline, inspect high/overshoot and return/hold measurements and configured thresholds, then update the local card with cairo.interpret_bookmap_observation with current revision and its evidence IDs. This is observation/confirmation only, not a trade setup; mode ${status.mode}. Write the card explanation as one short sentence, at most 180 characters: result and the main reason. Keep necessary uncertainty, omit repeated replay caveats and technical diagnostics. Do not infer consumption from price crossing.`})}>Ask AI</button>
          <details><summary>Details &amp; evidence</summary>
            <p>Crossed {time(observation.breakoutTime)} · Peak offer {observation.peakSize.toLocaleString()} shares · Pop ${price(observation.overshoot,status.tickSize)}.</p>
            <p>{observation.state==="confirmed"?"Quick return and measured hold below confirmed.":observation.state==="reclaimed"?"Price reclaimed the offer; prior rejection is no longer current confirmation.":observation.state==="extended"?"Pop exceeded the configured rejection limit.":observation.state==="expired"?"No qualifying return and sustained hold below were confirmed within the filter window.":"Waiting for a quick return and hold below."} Crossing alone does not prove offer consumption.</p>
            <pre className="narrative">{JSON.stringify(observation,null,2)}</pre></details>
        </article>
      })}
      {!status.setups.length && !status.observations.length && <p>Watching for setups and offer responses.</p>}
      {status.setups.slice(-2).reverse().map(setup=>{
        const analysis=snapshot.bookmapEvidence.analyses.find(a=>a.setupId===setup.id&&a.revision===setup.revision)
        const positions=snapshot.positions.filter(p=>p.symbol===symbol&&p.side==="short")
        return <article className="bookmap-setup" key={setup.id}>
          <p className="bookmap-result"><strong>{setup.patternId?.replaceAll("-"," ") ?? "Bid breakdown · history incomplete"}</strong><span className="bookmap-context-label">{setup.state}</span></p>
          <p className="bookmap-metrics">Bid wall ${price(setup.wallPrice,status.tickSize)} · Ask below: {setup.askBelow===null?"unknown":setup.askBelow?"yes":"no"}{setup.offerRejection?` · Prior offer rejection $${price(setup.offerRejection.price,status.tickSize)}`:""}</p>
          {setup.beforeBounce && <p>Before-break bounce: ${price(setup.beforeBounce.low,status.tickSize)} → high ${price(setup.beforeBounce.high,status.tickSize)} at {time(setup.beforeBounce.highTime)}</p>}
          {setup.afterBounce && <p>After-break bounce: ${price(setup.afterBounce.low,status.tickSize)} → high ${price(setup.afterBounce.high,status.tickSize)} at {time(setup.afterBounce.highTime)} · {setup.afterBounce.confirmed?"reversal observed":"provisional high"}</p>}
          {analysis && <AiExplanation text={analysis.explanation} />}
          <button disabled={pending||snapshot.copilotChat?.busy} onClick={()=>void command("/copilot/send",{commandId:crypto.randomUUID(),text:`Recognize the Bookmap entry setup independently for ${symbol}, setup ${setup.id}. Use cairo.read_setup_candidates and cairo.read_bookmap_timeline, inspect the actual mini bounce(s) before and after the bid break and prior offer rejection, read source rules, and update the local card with cairo.interpret_bookmap_setup with current revision and evidence IDs. This is ${status.mode} observation context, not trading approval. Write the card explanation as one short sentence, at most 180 characters: setup and key confirmation or uncertainty. Omit technical diagnostics.`})}>Ask AI</button>
          {positions.map(position=><button key={position.positionId} disabled={pending||status.mode!=="live"||!setup.patternId||setup.state==="invalidated"||status.readiness!=="ready"} onClick={()=>void command("/bookmap-pattern/accept-setup",{setupId:setup.id,revision:setup.revision,positionId:position.positionId})}>Accept for {position.symbol} short</button>)}
          <details><summary>Details &amp; evidence{setup.missing.length?` · ${setup.missing.length} uncertainties`:""}</summary>
            <p>Break {time(setup.breakTime)} · Day low coverage: observed window only.</p>
            {!!setup.missing.length && <p>{setup.missing.join(" · ")}</p>}
            <p>Default bounce filter: {snapshot.bookmapEvidence.parameters.bounceTicks} ticks / {snapshot.bookmapEvidence.parameters.bounceDurationMs} ms. Compare the path below; ask AI to examine a different wall or bounce, or use /bookmap-pattern to correct your trade tag.</p>
            <pre className="narrative">{JSON.stringify({...setup,events:status.events.filter(e=>BigInt(e.eventTime)>=BigInt(setup.breakTime)-10_000_000_000n).slice(-80)},null,2)}</pre>
          </details>
        </article>
      })}
    </div>)}
    {!!snapshot.bookmapEvidence.entries.length && <details><summary>Frozen entry setups</summary>{snapshot.bookmapEvidence.entries.slice(-5).reverse().map(entry=><p key={entry.id}>{entry.symbol} · {new Date(entry.filledAt).toLocaleTimeString()} · {entry.assessment?.summary ?? entry.detail}</p>)}</details>}
    {snapshot.bookmapEvidence.archiveError && <p role="alert">{snapshot.bookmapEvidence.archiveError}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>
}
