# Packaged Windows verification — October 5, 2026

Build `6c471624650b`, Cairo 0.1.0, Electron 44.5.1, OpenCode 2.0.22.
Command: `node scripts/smoke-package.mjs "release/Cairo 0.1.0 6c471624650b"`.

The harness launches the actual Cairo.exe twice with an isolated profile whose
path contains spaces and a PATH containing only Windows System32. It attaches to
the main debugger before application code runs and blocks external networking;
broker/chart responses are synthetic and model inference uses the local fake
provider. The Bookmap server is a separate fake loopback WebSocket.

Both runs passed minimize/restore, renderer reload with unchanged engine runtime,
token-file rotation adopted on refresh, snapshot bootstrap without alert,
observation reset/new source/reconnect, successful chart refresh followed by HTTP
500 retaining a labeled stale snapshot, sidecar termination and explicit restart,
and zero broker mutations. A second application launch preserved authored notes,
discarded tickets and used a new runtime. Hiding the bundled sidecar produced a
visible unavailable AI state while broker facts continued; restoring the binary
and restarting AI recovered. Both application exits returned zero. A subsequent
process inventory found no Cairo.exe or opencode.exe owned processes remaining.

The captured packaged screenshot was visually inspected: source states, notes,
chat and chart snapshot labels are legible with independent workspace scrolling.
One capture attempt immediately after restore failed with Electron UnknownVizError;
waiting for the shown window resolved it. Harness preparation also caught a
non-minute synthetic bar timestamp; the fixture was corrected without weakening
the production boundary validator.

Installed Bookmap live/replay metadata and real-account read connectivity were
not exercised. The producer deliberately exports unknown source mode; those
events remain context only. Synthetic verification proves the guarded behavior,
not that an installed feed is eligible to trigger an entry recommendation.
