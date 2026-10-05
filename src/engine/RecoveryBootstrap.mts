import type { CairoEngine } from "./CairoEngine.mts"
import type { RecoveryStore } from "./RecoveryStore.mts"
import type { ManagementMonitor } from "./ManagementMonitor.mts"
export class RecoveryBootstrap {
  private engine: CairoEngine; private recovery: RecoveryStore
  constructor(engine: CairoEngine, recovery: RecoveryStore, monitor: ManagementMonitor) {
    this.engine = engine; this.recovery = recovery
    const saved = recovery.snapshot
    monitor.restoreState(saved.rules)
    engine.updateSnapshot({ tickets: [], recommendations: [], guidanceProposals: [], noteProposals: [], executionReady: false,
      brokerAttempts: saved.attempts.map(item => ({ ...item, ticket: { ...item.ticket, state: "invalidated" }, state: item.state === "checkpointed" ? "unknown" : item.state })),
      attachments: saved.attachments.map(item => ({ ...item, state: "paused", pauseReason: "Restored after restart: review current holding, fills and allocations before resuming" })) })
  }
  cycle(): void {
    const snapshot = this.engine.getSnapshot(); const facts = snapshot.brokerFacts
    const fresh = Boolean(this.recovery.available && facts && snapshot.broker.state === "connected" && facts.ordersComplete && Date.now() - Date.parse(facts.asOf) >= 0 && Date.now() - Date.parse(facts.asOf) <= 60_000)
    const attachments = snapshot.attachments.map(item => item.state === "paused" && fresh && item.accountId === facts!.accountId && !facts!.positions.some(position => position.positionId === item.positionId && position.symbol === item.symbol) ? { ...item, state: "closed" as const, pauseReason: "Restored position is no longer held" } : item)
    if (fresh !== snapshot.executionReady || JSON.stringify(attachments) !== JSON.stringify(snapshot.attachments)) this.engine.updateSnapshot({ executionReady: fresh, attachments })
  }
}
