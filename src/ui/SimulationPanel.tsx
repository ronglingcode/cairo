import { useState } from "react"
import type { CairoSnapshot } from "../shared/contracts.mts"

export function SimulationPanel({ snapshot }: { snapshot: CairoSnapshot | null }) {
  const simulation = window.cairo?.simulation
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!simulation) return null
  async function control(action: "fill" | "reject", orderId: string) {
    setBusy(true); setError(null)
    try {
      const response = await fetch("/simulation/control", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.cairo?.commandToken}` }, body: JSON.stringify({ action, orderId }) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || "Simulator command failed")
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Simulator command failed") }
    finally { setBusy(false) }
  }
  return <aside className="simulation-panel">
    <strong>SIMULATION · {simulation.caseId}</strong>
    <span>{simulation.positionDescription} · synthetic prices · no live market or broker connection</span>
    <span>Start: type <code>/m</code>, select <code>/manage-trade</code>, then send. Confirm a scenario pattern if prompted. Restart the launcher to reset.</span>
    {snapshot?.brokerFacts?.workingOrders.filter(order => order.status === "working").map(order => <span key={order.orderId}>Order {order.orderId}: {order.quantity} shares · {order.orderType} <button disabled={busy} onClick={() => void control("fill", order.orderId)}>Simulate fill at mark</button> <button disabled={busy} onClick={() => void control("reject", order.orderId)}>Simulate rejection</button></span>)}
    {error && <span role="alert">{error}</span>}
  </aside>
}
