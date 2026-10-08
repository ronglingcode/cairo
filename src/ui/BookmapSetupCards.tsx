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
  return <section className="bookmap-evidence"><h3>Bookmap patterns &amp; SignalComposer</h3>
    <p>Patterns are detected by the Bookmap plugin. Cairo displays its events, confirmation context and composed signals.</p>
    {Object.entries(snapshot.bookmapEvidence.symbols).map(([symbol,status])=><div key={symbol}>
      <h4>{symbol} · {status.mode} · {status.readiness} · {status.coverage}</h4>
      {!!status.contexts.length && status.contexts.map(context=><p key={context.direction}>Developing {context.direction.toLowerCase()} context · {context.strength} confirmation · waiting for {context.waitingFor.replaceAll("_"," ").toLowerCase()} of {context.requiredTriggerSize.toLocaleString()} shares.</p>)}
      {status.signals.slice(-4).reverse().map(signal=><article className="bookmap-setup" key={signal.id}>
        <p className="bookmap-result"><strong>{signal.direction} · {signal.pattern.replaceAll("_"," ")}</strong><span className="bookmap-context-label">{signal.state.toLowerCase()}</span></p>
        <p>{signal.explanation}</p><p>Trigger {signal.size.toLocaleString()} shares @ ${price(signal.price,status.tickSize)} · {signal.confirmationStrength} confirmation</p>
        {snapshot.bookmapEvidence.analyses.filter(a=>a.setupId===signal.id&&a.revision===signal.revision).map(a=><AiExplanation key={a.setupId} text={a.explanation}/>)}
        <button disabled={pending||snapshot.copilotChat?.busy} onClick={()=>void command("/copilot/send",{commandId:crypto.randomUUID(),text:`Explain the plugin SignalComposer signal for ${symbol}, setup ${signal.id}. Read cairo.read_setup_candidates and cairo.read_bookmap_timeline, then annotate with cairo.interpret_bookmap_setup using the current revision, exact plugin patternId and recorded evidence IDs. Do not detect another pattern or invent bounce variants. Write one short sentence of at most 180 characters.`})}>Ask AI</button>
        <details><summary>Composition details</summary><pre className="narrative">{JSON.stringify(signal,null,2)}</pre></details>
      </article>)}
      {status.observations.slice(-6).reverse().map(observation=><article className="bookmap-setup" key={observation.id}>
        <p className="bookmap-result"><strong>{observation.type.replaceAll("_"," ")}</strong><span className="bookmap-context-label">{observation.meaning.replaceAll("_"," ").toLowerCase()}</span></p>
        <p>{observation.size.toLocaleString()} shares @ ${price(observation.price,status.tickSize)} · {observation.evidence.attribution.replaceAll("_"," ").toLowerCase()}</p>
        {snapshot.bookmapEvidence.observationAnalyses.filter(a=>a.observationId===observation.id&&a.revision===observation.revision).map(a=><AiExplanation key={a.observationId} text={a.explanation}/>)}
        <button disabled={pending||snapshot.copilotChat?.busy} onClick={()=>void command("/copilot/send",{commandId:crypto.randomUUID(),text:`Explain the plugin-detected ${observation.type} event for ${symbol}, observation ${observation.id}. Read cairo.read_setup_candidates and cairo.read_bookmap_timeline, then update cairo.interpret_bookmap_observation with its current revision and recorded evidence IDs. Explain the plugin's measured evidence and Composer role; do not independently detect or reclassify the pattern. Write one short sentence of at most 180 characters.`})}>Ask AI</button>
        <details><summary>Pattern evidence</summary><pre className="narrative">{JSON.stringify(observation,null,2)}</pre></details>
      </article>)}
      {!status.signals.length&&!status.observations.length&&<p>Waiting for plugin pattern events.</p>}
      {status.captureError&&<p role="alert">{status.captureError}</p>}
    </div>)}
    {!!snapshot.bookmapEvidence.entries.length&&<details><summary>Frozen entry compositions</summary>{snapshot.bookmapEvidence.entries.slice(-5).reverse().map(entry=><p key={entry.id}>{entry.symbol} · {new Date(entry.filledAt).toLocaleTimeString()} · {entry.assessment?.summary??entry.detail}</p>)}</details>}
    {snapshot.bookmapEvidence.archiveError&&<p role="alert">{snapshot.bookmapEvidence.archiveError}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>
}
