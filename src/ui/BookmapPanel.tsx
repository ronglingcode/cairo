import type { CairoSnapshot } from "../shared/contracts.mts"
export function BookmapPanel({ snapshot }: { snapshot: CairoSnapshot | null }) {
  const projection = snapshot?.bookmapProjection
  return <section className="panel"><h3>Bookmap observations</h3><p>{snapshot?.bookmap.detail ?? "Waiting for companion"}</p>
    {Object.entries(projection?.symbols ?? {}).map(([symbol, status]) => <p key={symbol}>{symbol} · {status.mode} · {status.readiness} · heartbeat {status.heartbeatAt}</p>)}
    {projection?.episodes.slice(-5).reverse().map(({ observation, freshEvent }) => <p key={`${observation.symbol.canonical}:${observation.episodeId}`}>{observation.symbol.canonical} · {observation.pattern} · ${observation.price} · revision {observation.revision} · {freshEvent ? "event evidence" : "context only"}</p>)}
  </section>
}
