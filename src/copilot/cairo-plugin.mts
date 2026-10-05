import { Plugin } from "@opencode/plugin"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { injectTradingContext } from "./TradingContext.mts"

type Bridge = (operation: string, input: unknown, context: Pick<ToolContext, "sessionID" | "signal">) => Promise<unknown>
const empty = { type: "object", properties: {}, additionalProperties: false } as const

export function createCairoPlugin(bridge: Bridge) {
  return Plugin.define({
    id: "cairo.domain",
    async setup(ctx) {
      await ctx.session.hook("context", input => injectTradingContext(input, sessionID => bridge("read_context", {}, {
        sessionID: sessionID as ToolContext["sessionID"], signal: AbortSignal.timeout(5000),
      })))
      await ctx.session.hook("title", async input => { input.result = "Cairo trading preparation" })
      await ctx.tool.transform(editor => {
        for (const tool of editor.list()) editor.remove(tool.id)
        editor.namespace({ name: "cairo", description: "Cairo preparation and trading context" })
        for (const operation of ["read_context", "read_preparation", "read_positions"]) {
          editor.add({ name: operation, description: "Read current bounded Cairo facts with source times and coverage. Chart bars are snapshots, never live triggers.", input: empty,
            options: { namespace: "cairo", codemode: false, permission: "cairo_read" },
            execute: async (input, context) => ({ content: JSON.stringify(await bridge(operation, input, context)) }),
          })
        }
        editor.add({ name: "propose_notes", description: "Propose a replacement of preparation notes for review. Does not save notes or activate position guidance.",
          input: { type: "object", properties: { markdown: { type: "string", maxLength: 65_536 }, date: { type: ["string", "null"] }, symbol: { type: ["string", "null"] }, expectedRevision: { type: ["string", "null"] } }, required: ["markdown", "date", "symbol", "expectedRevision"], additionalProperties: false },
          options: { namespace: "cairo", codemode: false, permission: "cairo_propose" },
          execute: async (input, context) => ({ content: JSON.stringify(await bridge("propose_notes", input, context)) }),
        })
        editor.add({ name: "propose_guidance", description: "Interpret the latest saved narrative into a review-only policy. Preserve exact clause wording. Ask about missing quantities, initial versus remaining shares, rounding and thresholds; never invent them. Unknown observations stay advisory/unsupported. Read context first. Use version 1 management with levels, allocations and rules. Rules contain id, clauseId, condition, action, recurrence and dependencies; quantities have explicit basis/value/rounding.",
          input: { type: "object", properties: { tradebookId: { type: "string" }, expectedPreparationRevision: { type: "string" }, expectedTradebookRevision: { type: ["string", "null"] }, clauses: { type: "array", maxItems: 60, items: { type: "object" } }, management: { type: "object" } }, required: ["tradebookId", "expectedPreparationRevision", "expectedTradebookRevision", "clauses", "management"], additionalProperties: false },
          options: { namespace: "cairo", codemode: false, permission: "cairo_propose" },
          execute: async (input, context) => ({ content: JSON.stringify(await bridge("propose_guidance", input, context)) }),
        })
        editor.add({ name: "stage_exit", description: "Check availability of exact exit/protection staging. Cannot execute orders; opening/increasing/reversing is prohibited.",
          input: { type: "object", properties: { intent: { type: "string", enum: ["close", "cancel-protection", "replace-protection"] }, symbol: { type: "string" }, quantity: { type: "integer", minimum: 1 } }, required: ["intent", "symbol"], additionalProperties: false },
          options: { namespace: "cairo", codemode: false, permission: "cairo_propose" },
          execute: async (input, context) => ({ content: JSON.stringify(await bridge("stage_exit", input, context)) }),
        })
      })
    },
  })
}

export default createCairoPlugin(async (operation, input, context) => {
  const endpoint = process.env.CAIRO_TOOL_ENDPOINT
  const token = process.env.CAIRO_TOOL_TOKEN
  if (!endpoint || !token || new URL(endpoint).hostname !== "127.0.0.1" || new URL(endpoint).protocol !== "http:") throw new Error("Cairo tool bridge is unavailable")
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ operation, input, sessionId: context.sessionID }), signal: AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]),
  })
  if (!response.ok) throw new Error("Cairo rejected the tool request; refresh context before continuing")
  return response.json()
})

