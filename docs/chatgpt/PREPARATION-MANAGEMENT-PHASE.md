# Premarket preparation and live trade management

User scope revision, October 4, 2026. The trader has not selected the Bookmap
patterns to care about and has moved Bookmap development to the end. The immediate use
case is to write notes to AI during premarket preparation, then use those notes
and current broker facts to help manage trades during the session. The first
runnable Cairo milestone uses the existing one-minute chart snapshot as its
market knowledge; chart context remains labeled with fetch/latest-bar time.

## First useful workflow

1. Write freeform preparation notes: thesis, symbols, levels, scenarios,
   invalidation, and management intentions as desired. No fields or setup
   templates are mandatory just to save notes and discuss them with AI.
2. Discuss the notes with Cairo's copilot. Preserve the original wording; AI
   can ask questions, organize a proposed plan, and identify ambiguity. The
   current saved notes are available during later chat turns and tool steps.
3. Enter trades through the existing trading platform. Cairo reads the selected
   Schwab account's current positions, protection orders, and confirmed fills.
4. Review the intended management for a specific position. AI references the
   preparation and current broker state, explains changes, and proposes actions.
   Notes are context until guidance is explicitly reviewed and attached; saving
   a note or agreeing to a plan does not approve an order.
5. Review each supported partial/full exit or protection change as an exact
   ticket. Every broker mutation requires current human approval and validation.

The first chat milestone can discuss preparation and positions before the full
rule interpreter or exit writer exists. Until those capabilities are delivered,
the copilot must report that attachment/staging/submission is unavailable.

## Current evidence and limits

Use current broker positions, working orders, confirmed fills, and fresh scoped
trader confirmations. Massive one-minute REST bars remain timestamped snapshot
context. A returned broker mark is labeled with its source/time and does not
establish a continuously observed price crossing.

There is no Bookmap observation feed in this phase. Notes such as “exit if bid
support breaks” can be discussed, but the app must show that the condition needs
trader confirmation or a future source. Do not substitute stale chart values or
invent a detector. A scoped confirmation applies to the named position and
condition; subsequent broker actions still need exact approval.

The existing read-only Bookmap-maintained Schwab credential handoff remains.
Deferring observation development does not request a new OAuth implementation
or eliminate the existing token keeper. No source change in `bookmap-plugin`
is needed for the current phase.

## Authored notes and position policy

Keep a small current preparation artifact in Electron's user-data directory
(`preparation.json` containing original Markdown, optional date/symbol context,
and a revision). This is editable working material, not a historical journal.
Explicit Save retains authored notes independently of AI availability; AI edits
are proposals that require acceptance. Saving preparation does not require a
machine-readable interpretation.

Reviewed tradebooks and frozen position attachments remain separate. Updating
today's notes or chat context cannot replace another position's active guidance.
AI receives the latest saved preparation plus each position's own reviewed
snapshot and fresh broker facts, with their identities and timestamps.

## Revised task sequence

Latest instruction (October 4): finish T22, T26–T28 and T33–T38 as ten separate
task commits, then continue the remaining work at 11:50 PM America/Los_Angeles.
For T17/T20/T25, broadcast and consume only `BID_STEP_UP` and `BID_REAPPEAR`.
Other plugin detectors are outside Cairo's broadcast selection. V-shape removal
is being handled in a separate Bookmap chat.

Preserve existing task IDs and completed commits. Start with **T23** (notes and
narrative workspace), then **T29 → T30 → T31 → T32** to deliver the copilot with
preparation and broker context. Next implement **T21 → T22 → T26 → T27 → T28 →
T33 → T34 → T35** for reviewed guidance and management evidence. Continue
**T36–T46** for approved exits/protection. Then implement the postponed Bookmap
feature tasks, followed by **T47–T50** for full acceptance, packaging, and guide.
Each task keeps its separate commit.

**T17–T20, T24, and T25 move to the final feature phase**, remain unchecked,
and stay required for the full MVP. They cover Bookmap export/config/status/ingestion,
pattern-specific reference seeding, and automatic entry observation. T16 stays
complete as a future bridge design; it is not a live integration claim. Resume
these tasks after the initial notes/chat and trade-management features, with the
required observations chosen before pattern-specific implementation. Revisit
T21/T28/T31/T35 to add the Bookmap capabilities once the bridge exists.

Of the existing 50 tasks, 18 are complete and 32 remain; 6 move to the final
feature phase. The first app milestone (T23, T29–T32, using completed T10) runs
with preparation and one-minute chart context without a Bookmap observation
stream. Full completion still includes the postponed Bookmap work.
