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
        options: { namespace: "cairo" },
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
        options: { namespace: "cairo", permission: "cairo_trade" },
        execute: async () => ({ content: "permission-granted-once" }),
      })
    })

    const tools = await ctx.tool.list()
    if (!tools.some((tool) => tool.id === "cairo_read_fixture")) {
      throw new Error("Cairo read fixture tool did not register")
    }
    console.info("CAIRO_PROBE_PLUGIN_LOADED", ctx.app.version)
  },
})
