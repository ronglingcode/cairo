import type { CairoEngine } from "./CairoEngine.mts"
export interface ManagementEvent { id: string; at: string; symbol: string; text: string }
export class ManagementTimeline {
  private seen = new Map<string, string>()
  private engine: CairoEngine
  private alert: (text: string) => void
  constructor(engine: CairoEngine, alert: (text: string) => void = () => {}) { this.engine = engine; this.alert = alert }
  capture(): void {
    const snapshot = this.engine.getSnapshot()
    const events: ManagementEvent[] = []
    for (const item of snapshot.recommendations) {
      if (this.seen.get(item.id) === item.state) continue
      this.seen.set(item.id, item.state)
      const text = `${item.quantity} shares: ${item.reason} (${item.state})`
      events.push({ id: `${item.id}:${item.state}`, at: new Date().toISOString(), symbol: item.symbol, text })
      if (item.state === "current") this.alert(`${item.symbol}: ${text}`)
    }
    if (events.length) this.engine.updateSnapshot({ managementTimeline: [...snapshot.managementTimeline, ...events].slice(-100) })
    const live = new Set(snapshot.recommendations.map(item => item.id))
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id)
  }
}
