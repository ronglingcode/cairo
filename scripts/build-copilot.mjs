import { build } from "esbuild"
await build({ entryPoints: ["src/copilot/cairo-plugin.mts"], bundle: true, platform: "node", format: "esm", outfile: "dist-copilot/cairo-plugin.js" })
