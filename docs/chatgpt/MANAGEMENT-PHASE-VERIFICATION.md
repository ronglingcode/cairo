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
