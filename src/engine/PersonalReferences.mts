import path from "node:path"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import type { TradebookStore } from "./TradebookStore.mts"
export async function seedPersonalReferences(store: TradebookStore, root: string): Promise<void> {
  if (await store.loadTradebook("personal-gap-give-go")) return
  const files = ["gap_give_and_go.md", "bid_reappear.md", "bid_step_up.md", "3-tier-live-trade-management.md"]
  const originals = await Promise.all(files.map(file => readFile(path.join(root, file), "utf8")))
  const markdown = originals.map((original, i) => `${original}\n\n---\nSource: Backtest/tradebooks/${files[i]}; imported reference, no order approval.\n`).join("\n")
  const clauses = [
    { clauseId: "personal-key-level", sourceText: "The entry still need to be above the key level, but it's ok to be below vwap or above vwap", coverage: "human" as const, mandatory: true, explanation: "Review the named key level and live location explicitly. There is no mandatory VWAP-side filter." },
    { clauseId: "personal-reappear", sourceText: "Seller cleared a big wall, price never gets below it. Later another wall appeared at the same price or higher price.", coverage: "human" as const, mandatory: true, explanation: "A BID_REAPPEAR badge supplies limited episode evidence; confirm the complete personal context." },
    { clauseId: "personal-stop", sourceText: "Stop loss is low of the day, if that's breached, we are done for the day for this stock for the long direction.", coverage: "unsupported" as const, explanation: "No continuous price source or reviewed numeric low/day-stop value is installed." },
    { clauseId: "personal-patience", sourceText: "So don't move stop loss, keep it at low of the day.", coverage: "advisory" as const, explanation: "Preserve patience; no automatic breakeven stop or broker mutation." },
    { clauseId: "personal-core", sourceText: "The most common core tier target is back to the intra day high.", coverage: "advisory" as const, explanation: "Typical target is context, not a numeric target selected for this trade." },
    { clauseId: "personal-tiers", sourceText: "- scalp: x%\n- core: y%\n- runner: z%", coverage: "unsupported" as const, explanation: "Trader must supply allocations; x/y/z are placeholders, never defaults." },
    { clauseId: "personal-runner", sourceText: "If it can breakout high of day and hold, we can extend to a higher target.", coverage: "unsupported" as const, explanation: "Hold/extension and target need trader definition; candles are historical context." },
  ]
  for (const clause of clauses) if (!markdown.includes(clause.sourceText)) clause.sourceText = clause.sourceText.replace(/\n/g, "\r\n")
  store.stageDraft({ id: "personal-gap-give-go", title: "Gap Give and Go (personal reference)", markdown, interpretation: { tradebookId: "personal-gap-give-go", narrativeHash: createHash("sha256").update(markdown).digest("hex"), clauses } })
  await store.activateDraft("personal-gap-give-go", null)
}
