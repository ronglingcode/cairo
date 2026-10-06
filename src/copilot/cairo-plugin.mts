import { BOOKMAP_CARD_ERRORS, type BookmapCardErrorCode } from "../shared/BookmapCardErrors.mts"
import { Plugin } from "@opencode/plugin"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { injectTradingContext } from "./TradingContext.mts"
import type { Skill } from "@opencode/schema/skill"
import { SkillLibrary, resolveSkills, type CairoSkill } from "./SkillLibrary.mts"
import { skillMentions } from "../shared/SkillCommands.mts"

type Bridge = (operation: string, input: unknown, context: Pick<ToolContext, "sessionID" | "signal"> & Partial<Pick<ToolContext, "messageID" | "id" | "agent">>) => Promise<unknown>
const empty = { type: "object", properties: {}, additionalProperties: false } as const

export function createCairoPlugin(bridge: Bridge, skillsDirectory = process.env.CAIRO_SKILLS_DIRECTORY) {
  return Plugin.define({
    id: "cairo.domain",
    async setup(ctx) {
      if (skillsDirectory) {
        const library = new SkillLibrary(skillsDirectory)
        let catalog: CairoSkill[] = []
        await ctx.skill.transform(editor => {
          for (const skill of editor.list()) if (String(skill.id).startsWith("cairo-skill-")) editor.remove(String(skill.id))
          for (const skill of catalog) editor.add({ id: skill.id as Skill.Info["id"], name: skill.name as Skill.Info["name"],
            path: skill.path as Skill.Info["path"], description: skill.description, content: skill.content })
        })
        await ctx.session.hook("prompt", async input => {
          const mentions = skillMentions(input.prompt.text)
          if (!mentions.length) return
          catalog = await library.load()
          const selected = resolveSkills(catalog, mentions.map(mention => mention.name))
          await ctx.skill.reload()
          input.prompt.skills = [...(input.prompt.skills ?? []), ...selected.map(skill => {
            const mention = mentions.find(mention => mention.name === skill.name)
            return { id: skill.id as Skill.Info["id"], ...(mention ? { mention: { start: mention.start, end: mention.end, text: mention.text } } : {}) }
          })]
          input.metadata = { ...input.metadata, cairoSkills: selected.map(skill => ({ name: skill.name, revision: skill.id })) }
        })
      }
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
        editor.add({ name:"read_entry_setup", description:"Read the frozen Bookmap assessment for a broker fill in the currently selected account. This preserves before/after bounce evidence available at execution; later market movement is separate. Archived evidence never proves a current live trigger.",
          input:{type:"object",properties:{fillId:{type:"string"}},required:["fillId"],additionalProperties:false},
          options:{namespace:"cairo",codemode:false,permission:"cairo_read"},
          execute:async(input,context)=>({content:JSON.stringify(await bridge("read_entry_setup",input,context))}),
        })
        for (const operation of ["read_bookmap_timeline", "read_setup_candidates"]) {
          editor.add({ name: operation, description: "Read causal Bookmap measurements, independently recognized bounce candidates, offer breakout/rejection observations, recognition parameters, coverage and original source rules. Offer observations are context/confirmation, not trade setups. A rejection requires a small measured high above the offer, quick return and measured hold below. Price crossing does not prove order consumption. Replay is analysis only. Times are nanosecond strings, prices USD. Never fabricate a level or confirm a trader tag.",
            input: { type: "object", properties: { symbol: { type: "string" }, start: { type: "string" }, end: { type: "string" } }, required: ["symbol"], additionalProperties: false },
            options: { namespace: "cairo", codemode: false, permission: "cairo_read" },
            execute: async (input, context) => ({content: JSON.stringify(await bridge(operation,input,context))}),
          })
        }
        editor.add({ name: "interpret_bookmap_setup", description: "Update the local card with an advisory AI interpretation on the live/replay setup card after reading the timeline and pattern rules. Write explanation as one short sentence of at most 180 characters, covering setup and main confirmation or uncertainty. Cite actual evidence IDs in their separate field. Revisions are checked. This does not confirm tags or authorize orders. Numeric levels must come from evidence; describe the exact selected bounce, before/after relation and prior offer rejection.",
          input: { type: "object", properties: { setupId: {type:"string"}, revision:{type:"integer"}, patternId:{type:["string","null"]}, selectedBounceId:{type:["string","null"]}, explanation:{type:"string",maxLength:2000}, evidenceIds:{type:"array",items:{type:"string"},minItems:1,maxItems:30} }, required:["setupId","revision","patternId","explanation","evidenceIds"], additionalProperties:false },
          options:{namespace:"cairo",codemode:false,permission:"cairo_propose"},
          execute: async (input,context)=>({content:JSON.stringify(await bridge("interpret_bookmap_setup",input,context))}),
        })
        editor.add({name:"interpret_bookmap_observation",description:"Update the local observation card with an explanation of an observed large-offer breakout or failed breakout/rejection after reading read_setup_candidates and read_bookmap_timeline. Use the current observation ID and revision, cite its evidence IDs. Write explanation as one short sentence of at most 180 characters: result plus the main reason or uncertainty. Do not repeat metrics already shown on the card or include revision IDs/technical boilerplate. These are observation/confirmation only; never promote them into a trade pattern or claim that the offer was consumed from price alone.",
          input:{type:"object",properties:{observationId:{type:"string"},revision:{type:"integer"},explanation:{type:"string",maxLength:2000},evidenceIds:{type:"array",items:{type:"string"},minItems:1,maxItems:30}},required:["observationId","revision","explanation","evidenceIds"],additionalProperties:false},
          options:{namespace:"cairo",codemode:false,permission:"cairo_propose"},
          execute:async(input,context)=>({content:JSON.stringify(await bridge("interpret_bookmap_observation",input,context))}),
        })
        editor.add({ name: "read_bookmap_pattern", description: "Read the trader-confirmed Bookmap tag, side-filtered active candidates and the linked source tradebook for a current position. Do not infer a tag or substitute another pattern's stop. Unconfirmed tags require the /bookmap-pattern picker.",
          input: { type: "object", properties: { positionId: { type: "string" } }, required: ["positionId"], additionalProperties: false },
          options: { namespace: "cairo", codemode: false, permission: "cairo_read" },
          execute: async (input, context) => ({ content: JSON.stringify(await bridge("read_bookmap_pattern", input, context)) }),
        })
        editor.add({ name: "read_target_context", description: "Read target context in one call: confirmed trade/pattern, notes and attached plan, initial/remaining shares, reconciled partial fills, early-partial budget and reserve, working exits, live Bookmap liquidity, and atrTargets containing configured ATR, session low of day and code-calculated long reference prices (low + multiple * ATR). Use saved multiples only; show dollar prices. Missing/stale inputs are explicit. Advisory only; do not invent allocations or treat wall size as a fill.",
          input: { type: "object", properties: { positionId: { type: "string" } }, required: ["positionId"], additionalProperties: false },
          options: { namespace: "cairo", codemode: false, permission: "cairo_read" },
          execute: async (input, context) => ({ content: JSON.stringify(await bridge("read_target_context", input, context)) }),
        })
        editor.add({ name: "read_trade_context", description: "Read shared management context for a current trade: broker position/account, confirmed Bookmap pattern with source rules, and its assigned tradebook. Shared by stops, targets and management. Unconfirmed patterns require the trader picker; missing/ambiguous tradebooks must not be guessed.",
          input: { type: "object", properties: { positionId: { type: "string" } }, required: ["positionId"], additionalProperties: false },
          options: { namespace: "cairo", codemode: false, permission: "cairo_read" },
          execute: async (input, context) => ({ content: JSON.stringify(await bridge("read_trade_context", input, context)) }),
        })
        editor.add({ name: "propose_notes", description: "Propose a replacement of preparation notes for review. Does not save notes or activate position guidance.",
          input: { type: "object", properties: { markdown: { type: "string", maxLength: 65_536 }, date: { type: ["string", "null"] }, symbol: { type: ["string", "null"] }, expectedRevision: { type: ["string", "null"] } }, required: ["markdown", "date", "symbol", "expectedRevision"], additionalProperties: false },
          options: { namespace: "cairo", codemode: false, permission: "cairo_propose" },
          execute: async (input, context) => ({ content: JSON.stringify(await bridge("propose_notes", input, context)) }),
        })
        editor.add({ name: "propose_guidance", description: "Interpret the latest saved preparation narrative into a review-only position policy. Tradebooks loaded from Backtest/tradebooks are read-only; this tool cannot create or edit them. Preserve exact clause wording. Ask about missing quantities, initial versus remaining shares, rounding and thresholds; never invent them. Unknown observations stay advisory/unsupported. Read context first. Use version 1 management with levels, allocations and rules. Rules contain id, clauseId, condition, action, recurrence and dependencies; quantities have explicit basis/value/rounding.",
          input: { type: "object", properties: { tradebookId: { type: "string" }, expectedPreparationRevision: { type: "string" }, expectedTradebookRevision: { type: ["string", "null"] }, clauses: { type: "array", maxItems: 60, items: { type: "object" } }, management: { type: "object" } }, required: ["tradebookId", "expectedPreparationRevision", "expectedTradebookRevision", "clauses", "management"], additionalProperties: false },
          options: { namespace: "cairo", codemode: false, permission: "cairo_propose" },
          execute: async (input, context) => ({ content: JSON.stringify(await bridge("propose_guidance", input, context)) }),
        })
        editor.add({ name: "stage_exit", description: "Stage an exact review-only exit from a current evidenced management recommendation. Read current facts, include its recommendationId and exact action fields. No submission or approval is granted. Explicit trader exits without a recommendation use the review controls. Opening/increasing/reversing is prohibited.",
          input: { type: "object", properties: { intent: { type: "string", enum: ["close", "cancel-protection", "replace-protection"] }, accountId: { type: "string" }, positionId: { type: "string" }, symbol: { type: "string" }, positionSide: { type: "string", enum: ["long", "short"] }, factsRevision: { type: "integer" }, quantity: { type: "integer", minimum: 1 }, orderType: { type: "string", enum: ["market", "limit", "stop", "stop-limit"] }, limitPrice: { type: ["number", "null"] }, stopPrice: { type: ["number", "null"] }, orderId: { type: "string" }, recommendationId: { type: "string" }, reason: { type: "string", maxLength: 4000 }, commandId: { type: "string" } }, required: ["intent", "accountId", "positionId", "symbol", "positionSide", "factsRevision", "quantity", "recommendationId", "reason", "commandId"], additionalProperties: false },
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
    body: JSON.stringify({ operation, input, sessionId: context.sessionID, source: context.messageID && context.id ? { messageID: context.messageID, id: context.id, agent: context.agent } : undefined }), signal: AbortSignal.any([context.signal, AbortSignal.timeout(operation === "stage_exit" ? 65_000 : 10_000)]),
  })
  if (!response.ok) {
    const detail=await response.json().catch(()=>null) as {code?:string} | null
    if (detail?.code && Object.hasOwn(BOOKMAP_CARD_ERRORS,detail.code)) throw new Error(BOOKMAP_CARD_ERRORS[detail.code as BookmapCardErrorCode])
    throw new Error("Cairo rejected the tool request; refresh context before continuing")
  }
  return response.json()
})


