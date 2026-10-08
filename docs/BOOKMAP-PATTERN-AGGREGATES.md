# Bookmap aggregate consumer

The plugin owns detection and SignalComposer. Cairo consumes complete `cairo_patterns` version-1 snapshots containing canonical events, composed signals/lifecycle, developing context, effective rule metadata and bounded liquidity. The old raw `cairo_evidence` and two-pattern `cairo_observation` protocols are rejected.

`BookmapEvidence` retains its API name for tool/archive compatibility but is now a validating projection. It contains no raw wall state, trade/BBO processor, swing detector, mini-bounce classifier or offer-response detector. `OfferObservations` is removed. Former detector environment variables no longer configure detection.

AI reads recorded IDs and prices and cannot replace the plugin patternId. Composed signals supply candidate cards; offer patterns supply context. Manual catalog tagging remains separate, so a generic breakdown is not automatically assigned to a bounce variant. Existing archives remain historical.

State is isolated by chart source/epoch. Complete snapshots repair skipped deliveries; stale sources/epochs/sequences/revisions and malformed batches are rejected. Reconnect history cannot become a live trigger on a following heartbeat. Disconnect clears live data. Reviewed observer attempts consume canonical events without detecting patterns and retain their existing two-pattern eligibility policy.

Entry archives freeze plugin composition and lifecycle information available at the fill for either direction; later updates cannot rewrite it. Target tools consume fresh aggregate liquidity rather than reconstructing wall history.

See the [plugin contract/config/replay guide](../../bookmap-plugin/docs/cairo-evidence.md). Verification uses TypeScript checking, Cairo tests/UI build and `scripts/verify-bookmap-bridge.mjs` with real Java output. The bridge check calls no model or broker. Rebuild/restart both applications together; these commands do not install or change live settings automatically.
