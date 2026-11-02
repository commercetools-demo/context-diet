# context-diet

A Claude Code mod that helps you save tokens. At the start of a new session it shows a one-line band above the prompt ("Loaded context could be trimmed. [Review] [Skip] [Never for this project]"). **Review** opens a pane that lists what is loaded (plugins, MCP servers, claude.ai connectors, skills, agents) with rough token estimates, lets you check or uncheck items, and lets you set the model and effort. Changes apply to this session only, or are saved to `.claude/settings.local.json`.

Everything is also available as a deterministic slash command (no model tokens, no permission prompt): `/diet`.

Tested with Claude Code **2.1.312** (terminal, macOS). Needs 2.1.287 or later.

## Install

```sh
claude --plugin-dir ./context-diet          # try it for one session (hot-reloads on save)
```

Or add the folder as a marketplace and install it (`claude plugin marketplace add <folder>`, then `claude plugin install context-diet`).

## Use

| Command | Effect |
|---|---|
| `/diet` | open the pane |
| `/diet status` | print what is trimmed, model, saved effort, estimates |
| `/diet off plugin:<name> mcp:<server> skill:<name> agent:<type>` | turn items off: this session **and** save to `.claude/settings.local.json` |
| `/diet on ...` | reverse `off` for the same targets |
| `/diet off ... --session` | session only, nothing written |
| `/diet model <name>` | save `model`, pre-fill `/model <name>` |
| `/diet effort <low\|medium\|high\|xhigh\|max>` | save effort, pre-fill `/effort <level>` |

Quote names with spaces: `/diet off mcp:"claude.ai Slack"`. After saving a plugin or MCP change the mod pre-fills `/reload-plugins`; press Enter.

In the pane, rows are `[x]` (kept) / `[ ]` (turned off). **Apply for this session** uses the mod's hooks only. **Save for this project** also writes the settings file.

### What each change does

| Item | This session (hooks) | Saved (`.claude/settings.local.json`) |
|---|---|---|
| MCP server / connector | tools described as disabled and deferred, calls denied with a message | `deniedMcpServers` (+ `disabledMcpjsonServers` for `.mcp.json` servers) |
| Plugin | its MCP tools, skills and agents denied/hidden | `enabledPlugins["name@marketplace"] = false` |
| Non-plugin skill | `Skill` tool call denied, command hidden | `skillOverrides[name] = "off"` |
| Plugin skill | same as above | not saved (turn off the whole plugin) |
| Agent type | not offered, `Agent` call denied | not saved (no key) |
| Model / effort | pre-fills `/model` / `/effort` | `model`; `effortLevel` and `modelSettings[<model>].effortLevel` if that entry exists |

All token numbers are **estimates**: `chars / 4`, or the "Always-on" figures from `claude plugin details`.

## Safety

No network calls. The mod reads settings, `.mcp.json` (server names only) and `.claude/agents` names/descriptions, runs `claude mcp list`, `claude plugin list --json` and `claude plugin details`, and writes **only** `<project>/.claude/settings.local.json`. It never touches `~/.claude.json`, and never overwrites a settings file that is not valid JSON. If your organization blocks user mods (`allowManagedModsOnly`, `allowManagedHooksOnly`, `disableAllHooks`) the mod simply does not load.

## Results for the brief's "known unknowns" (verified on 2.1.312)

1. **Record shapes.** `$.tool.list()` -> `{ name, description, mcp: boolean }`: there is **no server field**; the server is the middle of `mcp__<server>__<tool>`, where the server name has every character outside `[A-Za-z0-9_-]` replaced by `_` (`claude.ai Slack` -> `claude_ai_Slack`). `$.command.list()` -> `{ name, description, source: 'builtin'|'plugin'|'user'|'mcp', plugin? }`; **skills appear here** (plugin skills as `plugin:skill`, with `plugin` set). `tool.describe` input: `{ tool, description, isDeferred?, provider }`. `$.agent.list()` lists *running* agents, not agent types; types come from `agent.offer` events, which only fire once Claude lists agents, plus `.claude/agents/*.md` files.
2. **`command.run` args:** field is `e.args` (string, everything after the name). TRUE.
3. **`$.session.effort()`:** does **not exist** in 2.1.312. Effort is read from `$.settings.read()` (`modelSettings[model].effortLevel`, then `effortLevel`) and labelled "saved effort". There is no `effort` row in `$.config.list()` either.
4. **`deniedMcpServers` live?** No. Writing it did not disconnect a live server and `/reload-plugins` did not apply it; it took effect in the **next session** (the server's tools were gone from a fresh `claude -p`). So a saved MCP change needs a restart, not just `/reload-plugins`.
5. **`$.config.set` for the model:** works and changes the running model immediately (`claude-opus-5-5` -> `claude-haiku-5-5`), **but it also writes `model` to the user settings**, so it is not session-only. The mod does not use it; it pre-fills `/model` as the brief says. (`$.config.list()` shows the valid model aliases: default, sonnet, opus, haiku, fable, best, `[1m]` variants, opusplan.)
6. **claude.ai connectors in the Desktop app:** **not tested** (no Desktop app or connected connectors here). Per the brief the session-level hooks may be the only lever there; the pane says to use Customize - Connectors.
7. **Editing `model` / `effortLevel` mid-session:** does **not** change the running session (the merged settings see the new value, `$.session.model()` stays). Use the pre-filled `/model` / `/effort`.

## Known gaps and findings

- **`classic.SessionStart` is not used.** The built-in `cc-plugin-sec-default` plugin skips a hook on it (and prints a notice every session), and its `source` field would have been the natural signal. The mod decides in `session.start` instead: a *fresh* session (no turns, no transcript rows) counts as `startup`. Resume and fork have rows, `/clear` and compact fire no `session.start`. `asked:<session id>` in `$.store` stops a hot reload from asking twice. Edge case: after `/clear` a hot reload may ask again if `/clear` gives the session a new id.
- **Session-only MCP trimming does not lower `/context`.** MCP tool definitions are already deferred, so only names stay in context and the hooks cannot remove those names. Calls are denied with a clear message, but `/context` showed the same MCP tool count (38) after `/diet off mcp:... --session`. The real saving needs the saved route plus a new session. Same for skills: denying them leaves the skill listing tokens.
- No `prompt.section` trick for the skills listing was attempted (unverified, not shipped).
- Agent types are only known after Claude has listed them or from agent files on disk, so the Agents group may be short at the very start.
- The pane opened from `/diet` or the band button works at any width; the mod never opens it from the startup hook.
- Plugin list is project-aware: user-scope plugins and ones installed for this project.
- `tool.call` and `agent.offer` hooks fail open: if the mod throws, nothing is blocked.
- `tsc` was not available here, so the JS was checked by `claude plugin validate` and the tests only.
- Not tested by hand: the Desktop app and VS Code (covered by `claude plugin test` on `terminal`, `desktop`, `vscode` surfaces only), and clicking pane buttons with a mouse (the tests press them by key).

## Tests

```sh
claude plugin validate ./context-diet
claude plugin test ./context-diet
```

`tests/lib.test.ts` covers the arg parser, settings merge/round-trip, effort validation and the output parsers. `tests/plugin.test.tsx` mounts the band and pane on the terminal, desktop and vscode surfaces, runs `/diet off|on|effort|model`, checks the saved file round trip and the denial messages.
