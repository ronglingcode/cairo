# Private Windows package

From the committed lockfile: `npm ci`, `npm run typecheck`, `npm test`,
`npm run package:windows`. The output is a content-identified directory under
`release/Cairo 0.1.0 <build-id>`. Launch `Cairo.exe`.

Electron 44.5.1 supplies the runtime; OpenCode 2.0.22 and the self-contained Cairo
plugin are outside archives in `resources/opencode` and `resources/copilot`.
The renderer, engine and personal references are under `resources/app`.
No global Node/Bun, account keys or user artifacts are shipped. Build manifests
record built-file hashes and the lockfile hash. Third-party notices and Electron
Chromium notices are included. Existing outputs are never overwritten.

This private delivery is unpacked, unsigned and portable. Neither NSIS nor Inno
Setup is installed here, so a private installer is not produced. Bookmap remains
a separately installed companion. User state goes to Electron's user-data
directory; `CAIRO_USER_DATA` optionally selects a separate profile, including
paths containing spaces. Default AI provider is fake, with no inference charges.

T49 records actual executable launch/lifecycle checks. Installed Bookmap/live
account verification is not implied by a synthetic package smoke.
