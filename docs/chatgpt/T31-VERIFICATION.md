# T31 — Fresh context at every model step

The pinned plugin's actual `session.context` hook reads the backend before every primary model step, including tool continuations. It replaces earlier Cairo system injections, supplies saved preparation revision/date/symbol, bounded chart bars and source times, broker facts/revision, and available attachment identities. Historical chat is explicitly historical; notes are not activated guidance. Bookmap and execution remain unavailable.

The backend verifies the session's owned location. Reads have a five-second cancellation deadline, results older than ten seconds are rejected, and injection is limited to 32,000 characters with explicit truncation. Auxiliary title generation uses a fixed title instead of another model request. T32 provides user cancellation and rejects outdated session results.

Checks: real Windows OpenCode plus a loopback fake model verified that an outside fill and changed saved notes between a tool call and its continuation appear in the next model request. Unit checks covered stale/failed reads, replacement and size limits. TypeScript, production build and all 51 tests passed. No paid inference or orders.
