# Cairo skill library

The shared source library is `cairo/skills/<skill-name>/SKILL.md`. Humans and coding agents can edit these Markdown files directly. No credentials belong in skills.

Type `/` in either Cairo chat window to list skills. `/s` filters to `set-stop-loss` and `set-targets`. Use the arrow keys and Enter or Tab, or click a skill, to insert its command. Enter again sends the message. Shift+Enter inserts a newline; Escape closes the menu.

Examples:

```text
/set-stop-loss
/set-targets PCVX
/manage-trade What should I watch next?
/set-stop-loss /set-targets Explain the rationale in detail.
```

The native OpenCode prompt hook attaches the selected skill instructions to the request. `manage-trade` also attaches `set-stop-loss` and `set-targets`; repeated dependencies are included once. Skill revisions are recorded in message metadata. Native skill attachments preserve the loaded instructions for conversation replay.

The catalog refreshes when the composer gains focus. Files are reread for each explicit skill invocation, so an edit applies to the next invocation without restarting Cairo. A reply already underway keeps its existing instructions. Regular messages and automatic account-change notifications keep their existing behavior; this initial library is selected with slash commands.

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
