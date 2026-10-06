export interface AtrMarket {
  symbol: string
  sessionDate: string
  timestamp: number
  atr: number
  lowOfDay: number
  highOfDay: number
}

export function atrTargetContext(market: AtrMarket | undefined, side: string, now: number) {
  const missing = (reason: string) => ({ available: false as const, reason, levels: [] })
  if (!market) return missing("Bookmap ATR and day extremes are unavailable; load the updated plugin for this symbol")
  if (side !== "long") return missing("This ATR target formula applies to long positions")
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  if (market.sessionDate !== date || market.timestamp > now + 5000 || now - market.timestamp > 60_000) return missing("Bookmap ATR/day-low context is stale or from another session")
  if (!Number.isFinite(market.atr) || market.atr <= 0) return missing("Configured ATR is unavailable in the Bookmap trading plan")
  if (!Number.isFinite(market.lowOfDay) || market.lowOfDay <= 0) return missing("Current session low of day is unavailable")
  return {
    available: true as const, symbol: market.symbol, sessionDate: market.sessionDate,
    atr: market.atr, lowOfDay: market.lowOfDay, asOf: new Date(market.timestamp).toISOString(),
    source: "Bookmap native trading plan ATR and session low of day",
    formula: "lowOfDay + multiple * atr",
    // Reference prices only: the saved plan determines which multiples are actual targets.
    levels: [0.5, 0.8, 1, 1.5, 2].map(multiple => ({ multiple, price: Math.round((market.lowOfDay + multiple * market.atr + Number.EPSILON) * 100) / 100 })),
    advisory: true,
  }
}
