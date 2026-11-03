# Claude Code: save your usage

Every message re-sends the whole conversation. Smaller conversation = fewer tokens = more work before you hit your limit.

## 1. Set up once (2 minutes)

1. In Claude Code type: `/plugin marketplace add commercetools-demo/context-diet`
2. Then: `/plugin install context-diet@context-diet-local` and restart Claude Code.
3. At the start of a session, press **Review** on the band above the prompt (or type `/diet`), untick plugins and connectors you don't need today, then **Save for this project**.

## 2. Five habits that save the most

| Habit | How |
|---|---|
| **New topic? Start fresh** | `/clear` (free). Old chat is dead weight on every message. Use `/rename` first if you'll come back. |
| **Long task? Shrink it** | `/compact keep decisions and open questions`, at around 60-70% full, not 95%. |
| **Pick the right model** | `/model`: Sonnet for everyday work; Opus only for hard problems. |
| **Lower the effort** | `/effort medium` (or low) for simple asks. Max effort costs the most. |
| **Be specific** | "Summarise section 3 of *proposal.docx*" beats "look at my files". Point to a file; don't paste whole documents. |

## 3. See where it goes

| Command | What it shows |
|---|---|
| `/context` | What is filling the conversation right now. |
| `/usage` | Your plan limits, plus what used most (skills, plugins, connectors) with suggestions. Press **f** to apply fixes. |
| `/diet status` | What the mod has switched off, with rough token estimates. |
| Ask Claude | "Why is my usage so high?" The **context-coach** skill walks you through it. |

## 4. Optional extras (only if they fit your work)

| Tool | What and how |
|---|---|
| **Graphify** | For big code folders or many docs/PDFs: builds a map once so Claude searches it instead of re-reading files. Needs Python 3.10+ and `uv`. Easiest: ask Claude "set up Graphify" and the context-coach skill checks and installs what's missing (it asks first). Then `/graphify .` in your project. Vendor claims of 70x savings are unverified; small projects may not benefit, and documents/PDFs cost tokens to index. |
| **context-mode** | Keeps bulky tool output (logs, pages, big files) out of the chat. `/plugin marketplace add mksglu/context-mode`, then `/plugin install context-mode@context-mode`. Needs Node 22.5+. |
| **Not recommended for non-devs** | RTK (only trims terminal command output, which you rarely run). |

> **Quick rule:** finished something → `/clear`. Same task getting long → `/compact`. Simple task → Sonnet + medium effort.

*Saved MCP/connector changes take effect in the next session. Token numbers in /diet are estimates. Source: Anthropic "Manage costs effectively" (code.claude.com/docs/en/costs). Third-party savings figures are vendor-reported; check with /context.*
