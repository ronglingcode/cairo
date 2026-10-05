export function modelConfiguration(fake: boolean, model: string, fakeBaseUrl: string) {
  const id = fake ? "fixture" : model
  return {
    model: { providerID: "cairo-model", id },
    config: {
      snapshots: false,
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "provider.use", resource: "cairo-model", effect: "allow" },
        { action: "cairo_read", resource: "*", effect: "allow" },
        { action: "cairo_propose", resource: "*", effect: "allow" },
        { action: "cairo_exit", resource: "*", effect: "ask" },
      ],
      model: `cairo-model/${id}`,
      providers: { "cairo-model": {
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: fake ? fakeBaseUrl : "https://api.openai.com/v1", apiKey: fake ? "fixture-only" : "{env:CAIRO_OPENAI_API_KEY}" },
        models: { [id]: { name: fake ? "Local fake model" : model, capabilities: { tools: true } } },
      } },
    },
  }
}
