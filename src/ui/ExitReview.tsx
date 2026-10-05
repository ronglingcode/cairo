import { useState } from "react"
import type { CairoSnapshot, ExitAction, ExitOrderShape } from "../shared/contracts.mts"
export function ExitReview({ snapshot }: { snapshot: CairoSnapshot }) {
  const [positionId, setPositionId] = useState(""); const [quantity, setQuantity] = useState("")
  const [action, setAction] = useState<ExitAction>("close"); const [type, setType] = useState<ExitOrderShape["orderType"]>("market")
  const [limit, setLimit] = useState(""); const [stop, setStop] = useState(""); const [orderId, setOrderId] = useState(""); const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  const position = snapshot.positions.find(item => item.positionId === positionId)
  async function command(route: string, value: unknown) {
    setBusy(true); setError(null)
    try {
      const response = await fetch(`${window.cairo?.apiBaseUrl}/tickets/${route}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.cairo?.commandToken}` }, body: JSON.stringify(value) })
      const result = await response.json(); if (!response.ok) throw new Error(result.error)
    } catch (error) { setError(error instanceof Error ? error.message : "Exit review unavailable") } finally { setBusy(false) }
  }
  return <section className="tickets-card"><div className="card-heading"><div><span className="eyebrow">EXIT REVIEW</span><h2>Exact exit drafts</h2></div></div>
    <p>Stage an explicit exit or protection change for review. {snapshot.executionReady ? "Approval sends this exact close, cancel or replacement after current broker checks." : "Broker submission is unavailable; approval cannot submit."}</p>
    {snapshot.recoveryError && <p role="alert" className="chart-error">{snapshot.recoveryError}</p>}
    {snapshot.brokerAttempts.map(attempt => <p key={attempt.id}>{attempt.ticket.symbol} · {attempt.state} · {attempt.filledQuantity}/{attempt.ticket.quantity} shares filled · {attempt.detail}</p>)}
    <div className="chart-controls"><select aria-label="Exit position" value={positionId} onChange={event => setPositionId(event.target.value)}><option value="">Select holding</option>{snapshot.positions.map(item => <option key={item.positionId} value={item.positionId}>{item.symbol} · {item.side} · {item.quantity} shares</option>)}</select>
      <select aria-label="Exit action" value={action} onChange={event => setAction(event.target.value as ExitAction)}><option value="close">Close shares</option><option value="cancel-protection">Cancel protection</option><option value="replace-protection">Replace protection</option></select>
      <input aria-label="Exit shares" type="number" min={1} step={1} placeholder="Shares" value={quantity} onChange={event => setQuantity(event.target.value)} />
    </div>
    {action !== "close" && <select aria-label="Exact protection order" value={orderId} onChange={event => setOrderId(event.target.value)}><option value="">Select exact protection</option>{snapshot.brokerFacts?.workingOrders.filter(item => item.symbol === position?.symbol).map(item => <option key={item.orderId} value={item.orderId}>{item.orderId} · {item.orderType} · {item.status} · {item.quantity} shares</option>)}</select>}
    {action !== "cancel-protection" && <div className="chart-controls"><select aria-label="Exit order type" value={type} onChange={event => setType(event.target.value as ExitOrderShape["orderType"])}>{["market", "limit", "stop", "stop-limit"].map(value => <option key={value}>{value}</option>)}</select>{["limit", "stop-limit"].includes(type) && <input aria-label="Limit price" type="number" step="0.01" placeholder="Limit USD" value={limit} onChange={event => setLimit(event.target.value)} />}{["stop", "stop-limit"].includes(type) && <input aria-label="Stop price" type="number" step="0.01" placeholder="Stop USD" value={stop} onChange={event => setStop(event.target.value)} />}</div>}
    <input aria-label="Exit reason" placeholder="Reason for this exact change" maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} />
    <button className="quiet-button" disabled={busy || !position || !quantity || !reason.trim()} onClick={() => { if (position) void command("stage", { intent: action, accountId: snapshot.brokerFacts!.accountId, positionId, symbol: position.symbol, positionSide: position.side, factsRevision: snapshot.brokerFactsRevision, quantity: Number(quantity), ...(action !== "close" ? { orderId } : {}), ...(action !== "cancel-protection" ? { orderType: type, limitPrice: ["limit", "stop-limit"].includes(type) ? Number(limit) : null, stopPrice: ["stop", "stop-limit"].includes(type) ? Number(stop) : null } : {}), reason, commandId: crypto.randomUUID() }) }}>Stage exact draft</button>
    {error && <p className="chart-error" role="alert">{error}</p>}
    {snapshot.tickets.map(ticket => <article className="position-item" key={ticket.id}><strong>{ticket.symbol} · {ticket.action} · {ticket.state}</strong><p>Account {ticket.accountId} · {ticket.positionSide} · {ticket.quantity} shares</p><p>{ticket.exactPayload?.orderLegCollection[0]?.instruction} · {ticket.request?.orderType ?? "cancel"} · limit {ticket.request?.limitPrice ?? "—"} · stop {ticket.request?.stopPrice ?? "—"} · regular session · DAY</p><p>{ticket.reason}</p>{ticket.affectedOrders?.map(order => <p key={order.orderId}>Affected order {order.orderId} · {order.orderType} · {order.quantity} shares</p>)}<small>Expires {new Date(ticket.expiresAt).toLocaleTimeString()} · source {ticket.sourceClauseId ?? "explicit trader request"}</small>{ticket.state === "staged" && <button className="quiet-button" disabled={busy} onClick={() => void command("approve", { id: ticket.id, expectedHash: ticket.reviewHash })}>{snapshot.executionReady ? "Approve and send this exact request once" : "Approve this exact request once"}</button>}{ticket.state === "staged" && <button className="quiet-button" disabled={busy} onClick={() => void command("dismiss", { id: ticket.id })}>Dismiss draft</button>}</article>)}
  </section>
}


