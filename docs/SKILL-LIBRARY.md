# Cairo skill library

The shared source library is `cairo/skills/<skill-name>/SKILL.md`. Humans and coding agents can edit these Markdown files directly. No credentials belong in skills.

Type `/` in either Cairo chat window to list skills. `/s` filters to `set-stop-loss` and `set-targets`. Use the arrow keys and Enter or Tab, or click a skill, to insert its command. Enter again sends the message. Shift+Enter inserts a newline; Escape closes the menu.

Examples:

```text
/bookmap-pattern
/set-stop-loss
/set-targets PCVX
/manage-trade What should I watch next?
/set-stop-loss /set-targets Explain the rationale in detail.
```

The native OpenCode prompt hook attaches the selected skill instructions to the request. `manage-trade` also attaches `set-stop-loss` and `set-targets`; all three share `trade-context`, included once. Skill revisions are recorded in message metadata. Native skill attachments preserve the loaded instructions for conversation replay.

The catalog refreshes when the composer gains focus. Files are reread for each explicit skill invocation, so an edit applies to the next invocation without restarting Cairo. A reply already underway keeps its existing instructions. Regular messages and automatic account-change notifications keep their existing behavior; this initial library is selected with slash commands.

## Bookmap pattern tagging and stop routing

`/bookmap-pattern` opens a quick picker to tag or change a current trade’s pattern. `/bookmap-pattern SYMBOL` focuses a held symbol. With several holdings and no unique symbol, select the trade first. Cairo reads the side from fresh broker facts and offers only that side’s active patterns.

`/set-stop-loss`, `/set-targets` and `/manage-trade` use the same deterministic trade-context preflight. They open the picker if the trade is ambiguous or has no confirmed active tag. Clicking a pattern saves it, binds the original request to the selected symbol, side and position ID, and continues the request. Manual `/bookmap-pattern` selection saves the tag without sending an AI request. Cancel leaves the message draft available. The picker is shared by docked and detached chat windows.

In the preparation panel, expand **Tradebooks by stock and side**, add a symbol/side row, choose a library tradebook, and save notes. Each stock can have one long and one short assignment. These assignments persist with preparation and resolve in code from the actual broker position's symbol and side, independent of chart focus. AI note proposals preserve the assignments. Missing library sources stay visible as unavailable; duplicates are rejected when saving.

The shared `cairo.read_trade_context` tool returns the current account/position, confirmed pattern and source, and resolved tradebook. An existing matching position attachment supplies a fallback assignment. If it disagrees with the preparation assignment, the tool reports a conflict and preserves both; changing an assignment never replaces or activates attached guidance. Unassigned books need clarification only when the requested answer requires that book. The pattern's linked source remains distinct from the stock's assigned tradebook.

The canonical catalog is `Backtest/tradebooks/bookmap_patterns/activePatterns.md`, under the configured `CAIRO_TRADEBOOK_PATH`. Edit its Long/Short tables to maintain stable pattern IDs, labels and local tradebook links. Cairo rereads the catalog and linked Markdown each invocation. Unmapped patterns return no source; a source without a stop rule remains undefined. Currently bid vwap shape recovery and bid breakdown need mappings, and bid reappear needs a stop rule.

Tags persist in `bookmap-pattern-tags.json` inside Cairo’s user-data directory. They are scoped to account, position, side and an observed trade instance. Quantity changes preserve a tag; an observed flat holding or side change retires it. A broker position ID reused after going flat gets a new trade instance. On restart the previous tag remains visible but requires one-click reconfirmation, since a trade may have closed and reopened while Cairo was offline. Account changes cannot reuse another account’s tag.

The AI’s `cairo.read_bookmap_pattern` tool returns the confirmed tag, active candidates and selected source narrative. The AI cannot save a tag; the trader chooses it in the picker. Tagging does not attach executable guidance or submit broker orders. Test the picker with synthetic holdings using `npm run build` followed by `npm run preview:fake -- --patterns`.

## Add or edit a skill

Create a folder matching a lowercase, hyphenated name (at most 63 characters), with a `SKILL.md` file:

```yaml
---
name: example-skill
description: Explain what the skill does and when it is useful.
metadata:
  includes:
    - set-stop-loss
---
```

Write the workflow below the frontmatter. `metadata.includes` is optional and contains other skill names to compose. Keep links to those files in the workflow so human and AI editors can follow them. Cairo rejects missing dependencies, dependency cycles, mismatched names and invalid frontmatter before sending a request.

Use skills for reusable reasoning and response instructions. Use saved preparation and attached guidance for actual trading rules. Skill selection does not activate guidance, approve an order, grant new tools, or change the engine's execution permissions. The starter files are workflows; they do not supply a universal stop price or profit target.

Files are limited to 32 KB each, with at most 64 skills and 64 KB of instructions per invocation. Directory links are skipped; linked `SKILL.md` files are rejected. Only folders containing `SKILL.md` enter the catalog.

Development defaults to the repository's `skills` folder. Windows packages include the folder at `resources/app/skills`. To keep one library across machines or package upgrades, set an absolute `CAIRO_SKILLS_DIRECTORY` before launching Cairo:

```powershell
$env:CAIRO_SKILLS_DIRECTORY = 'C:\Users\lingr\code\cairo\skills'
```

The launcher passes this same directory to the chat API and OpenCode plugin. Updates to these files can be reviewed and committed with the application source.
