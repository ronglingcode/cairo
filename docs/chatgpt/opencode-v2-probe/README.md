# OpenCode V2 Windows integration probe

This fixture proves the selected Windows sidecar can load a bundled Cairo plugin, execute a fake read through model tool continuation, and carry an explicit one-time approval through its real permission API and event stream. It makes no real model or broker requests.

## Repeat the automated check

In PowerShell:

```powershell
Set-Location C:\Users\lingr\trading\cairo\docs\chatgpt\opencode-v2-probe
npm ci --no-audit --no-fund
npm run probe
```

If dependencies are already installed, only `npm run probe` is needed. The last line must be `ALL CHECKS PASSED`. A nonzero exit or missing final line means verification failed.

## Verify it yourself

```powershell
Set-Location C:\Users\lingr\trading\cairo\docs\chatgpt\opencode-v2-probe
npm run probe:manual
```

1. Confirm the fake read prints `cairo-fake-read-ok` through a `PASS` line.
2. The first fake action should stop at `Type once:`. Enter `once`.
3. The second fake action should stop at a new request, despite the first approval. Enter `reject`.
4. Confirm the rejection prevents the second action from completing, no saved permissions exist, the owned server stops, and the script ends with `ALL CHECKS PASSED`.

No credentials or account setup are needed. This uses terminal prompts to send real client decisions; it does not verify Cairo's future approval UI. Share the final output if this behaves differently on your machine. The script prints its temporary artifact directory, containing the real session `context.json`, `permissions.json`, and captured server output.

## What was corrected

- Explicit `codemode: false` exposes the fixture tools directly to the model. The earlier fake model called a direct tool name without explicitly choosing this exposure; absence from the direct tool list did not prove registration failed.
- The pinned client's request field is `decision: "once"`. The live `permission.replied` event carries `reply: "once"`. The old direct mock conflated these contracts.
- Custom tool metadata alone did not pause the fake executor in this pinned runtime. The mock Cairo backend now explicitly creates a permission request, waits for the live reply matching its session/request ID, and accepts only `once` before returning the fake action result. A second identical resource still requires a new request. This models the explicit adapter boundary; it does not prove production broker authorization.
- A bundled plugin eliminates runtime resolution of external npm modules. Fresh XDG/config directories isolate the probe from the user's OpenCode settings, credentials, and sessions.

The fake provider checks OpenCode's actual tool catalog and makes a bounded sequence of six synthetic model responses. Failure to expose a tool stops the probe instead of creating an endless tool-call loop. Shutdown terminates only the exact child server launched by this script.

## Pinned compatibility and packaging

Verified on Windows x64 with Node 24.21.0/npm 11.19.0 for development:

| Component | Version | License | Role |
| --- | --- | --- | --- |
| `@opencode/cli` | 2.0.22 | MIT | Package-installed native Windows server binary |
| `@opencode/cli-windows-x64` / baseline artifact | 2.0.22 | MIT | Platform binary selected by CLI postinstall |
| `@opencode/client` | 2.0.22 | MIT | Real HTTP client and live event subscription |
| `@opencode/plugin` | 2.0.22 | MIT | `Plugin.define` and tool registration API |
| `esbuild` | 0.28.2 | MIT | Development build tool for the plugin bundle |

All package resolutions/integrities are recorded in `package-lock.json`. The child server's PATH contains only Windows system directories, so it cannot depend on globally installed Node or Bun. It loads one esbuild-produced plugin JavaScript file with no external module imports from `.opencode/plugins/`. The fake provider and driver run in the development Node process.

Cairo can ship the native CLI executable outside Electron's archive, plus a bundled plugin and its own config, and bundle the Promise client into Electron main/preload as appropriate. Electron supplies the application Node runtime. T29 must implement this owned-process arrangement; T48 must verify the complete distributed Windows application, resource paths, and all third-party notices. This probe is not the final application package.

OpenCode's upstream MIT notice is retained in [OPENCODE-LICENSE.txt](OPENCODE-LICENSE.txt). esbuild is a build dependency; its installed `LICENSE.md` supplies its notice. The eventual executable distribution also needs applicable notices for embedded dependencies.

Primary references: [plugin lifecycle and tools](https://opencode.ai/v2/docs/build/plugins/), [permissions and one-time decisions](https://opencode.ai/v2/docs/permissions), [provider configuration](https://opencode.ai/v2/docs/providers), [upstream license](https://github.com/anomalyco/opencode/blob/dev/LICENSE). The installed 2.0.22 client declarations and the passing server probe are the version-specific evidence.
