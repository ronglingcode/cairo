import type { BrokerPosition } from "./contracts.mts"

export interface BookmapPattern {
  id: string
  name: string
  side: "long" | "short"
  sourceFile: string | null
}
export interface BookmapPatternTag {
  revision: string
  accountId: string
  positionId: string
  symbol: string
  side: "long" | "short"
  patternId: string
  taggedAt: string
  runtimeInstanceId: string
  tradeInstanceId: string
  active: boolean
}
export interface BookmapPatternPicker {
  id: string
  text: string
  commandId: string
  accountId: string
  factsRevision: number
  manual: boolean
  positions: Array<{ position: BrokerPosition; tradeInstanceId: string; tag: BookmapPatternTag | null; candidates: BookmapPattern[] }>
}
