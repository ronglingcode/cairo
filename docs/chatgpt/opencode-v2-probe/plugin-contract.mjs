import assert from "node:assert/strict"

const registered = []
const editor = {
  namespace() {},
  add(definition) {
    const namespace = definition.options?.namespace
    registered.push({ ...definition, id: namespace ? `${namespace}_${definition.name}` : definition.name })
  },
  list() {
    return registered
  },
}

const pluginModule = await import("./.opencode/plugins/cairo-probe.ts")
await pluginModule.default.setup({
  app: { version: "2.0.22" },
  tool: {
    async transform(apply) {
      apply(editor)
    },
    async list() {
      return registered
    },
  },
})

const read = registered.find((item) => item.id === "cairo_read_fixture")
assert.ok(read, "V2 plugin registers the namespaced Cairo read fixture")
assert.deepEqual(await read.execute({}, {}), { content: "cairo-fake-read-ok" })

const action = registered.find((item) => item.id === "cairo_request_exit")
assert.ok(action, "V2 plugin registers the inert permission probe action")
assert.equal(action.options.codemode, false)
console.log("plugin-contract-ok: fixture registered two direct tools and ran the fake read; use npm run probe for real server/permission verification")
