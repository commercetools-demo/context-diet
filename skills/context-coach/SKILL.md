---
name: context-coach
description: Plain-language help for saving Claude Code usage. Use when the user asks why usage is high, how to save tokens, whether to /clear or /compact, which model to use, or wants to set up Graphify.
---

# Context coach

Explain in plain, non-technical language. No jargon. Max 5 short bullets per answer.

## Steps

1. Ask Claude Code's own numbers first: tell the user to run `/context` (what fills the window) and `/usage` (what counts against their plan). Do not guess.
2. Diagnose with this list, most common first:
   - **Same session for unrelated tasks** -> `/clear` between topics (free). `/rename` first if they want to come back.
   - **Long session, same task** -> `/compact` with a hint, e.g. `/compact keep decisions and open questions`. Best at ~60-70% full.
   - **Heavy model for light work** -> `/model` to Sonnet for everyday work; Opus only for hard problems.
   - **High effort for simple asks** -> `/effort medium` or `low`.
   - **Unused plugins / connectors loaded** -> `/diet` (context-diet) and switch off what they do not use; restart needed for saved MCP changes.
   - **Vague prompts** -> name the file or folder and the exact outcome; broad asks cause broad file scanning.
   - **Big pasted files / PDFs** -> point Claude at the file path, ask for a specific section, do not paste whole documents.
   - **Coming back after a break** -> the cache has expired, so the first message re-reads everything; `/clear` instead if the old context is not needed.
3. Offer to run `/diet status` for them and summarise.
4. Only mention optional tools (Graphify for large code or document folders, context-mode for heavy tool output) if they work with a big repository or many documents. Say that savings claims are vendor-reported and to measure with `/context`.

## Setting up Graphify (only when the user asks for it)

Graphify needs Python 3.10+ and `uv` (or `pipx`). Follow these steps in order:

1. **Check, change nothing:**
   `bash "${CLAUDE_SKILL_DIR}/scripts/check-graphify.sh"`
   Explain the result in plain words (what is present, what is missing).
2. **Dry run:**
   `bash "${CLAUDE_SKILL_DIR}/scripts/install-graphify.sh"`
   Show the user the list of things it would install. If the plan includes the `curl ... | sh` uv installer or `brew install`, say so plainly: it downloads and runs software on their computer.
3. **Get explicit consent**, then install:
   `bash "${CLAUDE_SKILL_DIR}/scripts/install-graphify.sh" --yes`
   Never pass `--yes` without a clear "yes" from the user in this conversation.
4. Tell the user to restart Claude Code, open their project folder, and type `/graphify .`. Remind them: the first run on documents or PDFs uses tokens, and small projects may see no saving.
5. To remove it: `graphify uninstall`.

Notes:
- The scripts never use `sudo`. If something needs it (e.g. Python on Linux without Homebrew), they print the command for the user to run themselves.
- On Windows the install script prints PowerShell `winget` commands instead of running anything.
- If a step fails, show the error in plain words and stop; do not retry with other installers.

## Rules

- Never change settings or install software without telling the user what and why.
- Prefer habits over tools; recommend at most 2 actions.
