import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "cairo.probe",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "cairo", description: "Fake Cairo integration probe tools" })
      editor.add({
        name: "read_fixture",
        description: "Read the fixed, non-sensitive Cairo probe fixture.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        options: { namespace: "cairo", codemode: false, permission: "cairo_read" },
        execute: async () => ({ content: "cairo-fake-read-ok" }),
      })

      editor.add({
        name: "request_exit",
        description: "Probe-only permission action; it never contacts a broker.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        options: { namespace: "cairo", codemode: false, permission: "cairo_trade" },
        execute: async (_input, context) => {
          // Mock Cairo backend: explicitly ask through the real OpenCode client.
          // Tool registration metadata alone is not order approval.
          const approvalURL = process.env.CAIRO_PROBE_APPROVAL_URL
          if (!approvalURL || !approvalURL.startsWith("http://127.0.0.1:")) {
            throw new Error("The isolated probe approval bridge is unavailable")
          }
          const response = await fetch(approvalURL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionID: context.sessionID, messageID: context.messageID, id: context.id }),
            signal: context.signal,
          })
          if (!response.ok || (await response.json()).approved !== true) {
            throw new Error("Probe permission rejected; fake action did not execute")
          }
          return { content: "permission-granted-once" }
        },
      })
    })

    const tools = await ctx.tool.list()
    if (!tools.some((tool) => tool.id === "cairo_read_fixture")) {
      throw new Error("Cairo read fixture tool did not register")
    }
    console.info("CAIRO_PROBE_PLUGIN_LOADED", ctx.app.version)
  },
})
