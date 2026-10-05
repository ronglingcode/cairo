# Management implementation checks

## T22

Added a bounded internal management representation with clause-linked conditions,
exit/protection actions, explicit quantity basis/rounding, fixed-at-attachment
levels, optional allocations, once/rearm semantics and actual-fill dependencies.
Unknown shapes, ambiguous quantities, undefined levels, duplicate actions and
dependency cycles are rejected. Unsupported mandatory clauses block monitoring;
independent unavailable-source rules retain explicit coverage issues. No trader
policy defaults or generated code are installed.

Typecheck and five targeted checks passed: two distinct authored styles, exact
wording, stable action identity across rule renames, invalid/ambiguous inputs,
unavailable current sources and existing artifact persistence compatibility.

## T26

Added capability-protected explicit attach/pause/reconfirm commands. Attachments
freeze original narrative and interpretation, reviewed initial filled quantity,
current account/position and allocations. Missing review, stale facts/revisions,
fractional holdings and mismatched allocation sums are rejected. Engine polling
reconciles outside quantity/basis/side/fill changes to paused or closed state.
Source edits and chart focus cannot replace a position's frozen guidance.
Typecheck and two targeted lifecycle/style checks passed. Review UI follows in
T28/T34; persistence/restart reactivation follows in the recovery tasks.

## T27
Deterministic per-position monitoring, bounded confirmations, once-only recommendations, and dependencies gated by actual matching fills. Targeted monitor fixtures and typecheck pass. Broker writes remain absent.

## T28
Attached prose, per-rule evidence/quantity/status, scoped observation confirmation, pause/rearm/resume, bounded session timeline, and deduplicated desktop recommendation alerts. Typecheck and three synthetic monitor/timeline checks pass. No approval or broker write is exposed.

## T33
The owned-session propose_guidance tool stages complete engine-validated interpretations of the current saved prose. Exact clause text, hash/revision binding, numeric provenance, quantity basis and rounding are required; unresolved portions remain visible. Two authored-style fixtures plus invented/missing/partial/stale output checks and typecheck pass; plugin bundle builds.

## T34
Capability-protected explicit accept/reject for note and guideline artifacts; saved notes use existing serialized CAS. Guidance acceptance can attach/replace only the reviewed current position, revision and initial shares. Artifacts preserve exact bytes. Completed actions conservatively carry across edits/renames of the same close/protection order type; pending broker actions block replacement. Four artifact/review fixtures and typecheck pass.

## T35
Opt-in account/recommendation updates coalesce into one latest bounded summary, at most every 15 seconds while AI is available and idle. Repeated timestamps/marks do not wake. Cancellation or uncertain delivery pauses updates; machine metadata grants no approval. Current context includes frozen per-position guidance with explicit truncation. Verified actual pinned session.synthetic requires msg_ IDs and streams a local fake-provider response. Four chat/waker checks and typecheck pass.

## T36
Pure SINGLE equity market/limit/stop/stop-limit close payloads derive SELL or BUY_TO_COVER from current holdings. Only whole shares, NORMAL session and DAY duration; prices format to cents while sub-cent input requires clarification. No entry factory or network writer. Long/short/price/invalid-shape fixtures and typecheck pass. Live broker submission remains for later approved-writer work.
