import type { CairoSnapshot } from "../shared/contracts.mts"
import type { RendererConnectionState } from "../renderer/EngineConnection.mts"
import { ProposalReview } from "./ProposalReview"
import { ManagementPanel } from "./ManagementPanel"
import { ExitReview } from "./ExitReview"
import { BookmapPanel } from "./BookmapPanel"

export function LiveContext({ snapshot, connectionState }: { snapshot: CairoSnapshot | null; connectionState: RendererConnectionState }) {
  const time = (value: string | null | undefined) => value ? new Date(value).toLocaleTimeString() : "time unknown"
  const staged = snapshot?.tickets.filter(ticket => ticket.state === "staged").length ?? 0
  const recommendations = snapshot?.recommendations.filter(item => item.state === "current").length ?? 0
  return <div className="live-context">
    <div className="live-sources"><span className={`status-dot ${connectionState === "connected" ? "online" : "warning"}`} />Engine {connectionState} · Schwab {snapshot?.broker.state ?? "unknown"} · Bookmap {snapshot?.bookmap.state ?? "unknown"}</div>
    {!!snapshot?.positions.length && <div className="live-holdings" aria-label="Open positions">{snapshot.positions.map(position => <span key={position.positionId}>{position.symbol} · {position.side} {position.quantity} · {position.markPrice === null ? "mark unknown" : `$${position.markPrice.toFixed(2)}`}</span>)}</div>}
    {(staged > 0 || recommendations > 0) && <p className="live-review-notice" role="status">{staged} staged tickets · {recommendations} current recommendations · open Trading context to review</p>}
    {snapshot?.recoveryError && <p role="alert" className="chart-error">{snapshot.recoveryError}</p>}
    <details className="live-context-details"><summary>Trading context · {snapshot?.positions.length ?? 0} positions · {snapshot?.tickets.length ?? 0} tickets</summary><div className="live-context-body">
      {!snapshot && <p>Waiting for the engine snapshot.</p>}
      {snapshot && <>
        <p>Schwab: {snapshot.broker.state} · {snapshot.broker.detail} · {time(snapshot.broker.updatedAt)}</p>
        <p>Chart: {snapshot.chart?.symbol ?? "none"} · {snapshot.chart?.source.state ?? "unknown"} · snapshot {time(snapshot.chart?.fetchedAt ?? null)}</p>
        {snapshot.brokerFacts?.accountAvailability && <p>Buying power: {snapshot.brokerFacts.accountAvailability.buyingPower?.toLocaleString("en-US", { style: "currency", currency: "USD" }) ?? "unknown"} · {time(snapshot.brokerFacts.accountAvailability.updatedAt)}</p>}
        {!snapshot.positions.length && <p>{snapshot.broker.state === "connected" ? "No open positions." : "Positions unavailable until broker reads complete."}</p>}
        {snapshot.positions.map(position => <div className="live-position" key={position.positionId}>
          <strong>{position.symbol} · {position.side} · {position.quantity} shares</strong>
          <span>Mark {position.markPrice === null ? "unknown" : `$${position.markPrice.toFixed(2)}`} · {time(position.markUpdatedAt)}</span>
          <span>Guidance: {snapshot.attachments.find(item => item.positionId === position.positionId && item.accountId === snapshot.brokerFacts?.accountId)?.state ?? "unattached"}</span>
          {snapshot.brokerFacts?.workingOrders.filter(order => order.symbol === position.symbol).map(order => <span key={order.orderId}>{order.orderType} · {order.side} · {order.quantity} shares · {order.status}{order.stopPrice != null ? ` · stop $${order.stopPrice.toFixed(2)}` : ""}{order.limitPrice != null ? ` · limit $${order.limitPrice.toFixed(2)}` : ""} · order {order.orderId}</span>)}
          <small>{snapshot.brokerFacts?.ordersComplete ? "Order coverage current" : "Order coverage incomplete"}</small>
        </div>)}
        {!!snapshot.brokerFacts?.recentFills.length && <details><summary>Recent fills</summary>{snapshot.brokerFacts.recentFills.slice(-5).reverse().map(fill => <p key={fill.fillId}>{fill.symbol} · {fill.side} · {fill.quantity} @ ${fill.price.toFixed(2)} · {time(fill.filledAt)}</p>)}</details>}
        <ProposalReview snapshot={snapshot} />
        <ManagementPanel snapshot={snapshot} />
        <BookmapPanel snapshot={snapshot} />
        <ExitReview snapshot={snapshot} />
      </>}
    </div></details>
  </div>
}
