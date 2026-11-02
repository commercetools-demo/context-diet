// Parser for the arguments of `/diet`.

const KINDS = ['plugin', 'mcp', 'skill', 'agent']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// Splits on whitespace; "double" and 'single' quotes group, and may sit in the
// middle of a word: mcp:"claude.ai Slack" is the one token mcp:claude.ai Slack.
export function tokenize(text) {
  const tokens = []
  let cur = ''
  let has = false
  let quote = null
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (/\s/.test(ch)) {
      if (has || cur) tokens.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (quote) throw new Error(`unterminated ${quote} quote`)
  if (has || cur) tokens.push(cur)
  return tokens
}

export function parseTarget(token) {
  const i = token.indexOf(':')
  if (i < 1) throw new Error(`"${token}" is not kind:name (kinds: ${KINDS.join(', ')})`)
  const kind = token.slice(0, i)
  const name = token.slice(i + 1)
  if (!KINDS.includes(kind)) throw new Error(`unknown kind "${kind}" in "${token}" (kinds: ${KINDS.join(', ')})`)
  if (!name) throw new Error(`"${token}" has no name`)
  return { kind, name, id: `${kind}:${name}` }
}

// -> { ok: true, action, targets, session, value } | { ok: false, error }
// action: open | status | help | off | on | model | effort
export function parseDiet(text) {
  let tokens
  try {
    tokens = tokenize(text || '')
  } catch (err) {
    return { ok: false, error: err.message }
  }
  if (tokens.length === 0) return { ok: true, action: 'open', targets: [], session: false }
  const [action, ...rest] = tokens
  if (action === 'status' || action === 'help') return { ok: true, action, targets: [], session: false }
  if (action === 'off' || action === 'on') {
    const session = rest.includes('--session')
    const items = rest.filter(t => t !== '--session')
    if (items.length === 0) return { ok: false, error: `/diet ${action} needs targets, e.g. ${action} mcp:"claude.ai Slack"` }
    try {
      return { ok: true, action, targets: items.map(parseTarget), session }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }
  if (action === 'model') {
    if (rest.length !== 1) return { ok: false, error: '/diet model <name>' }
    return { ok: true, action, targets: [], value: rest[0], session: false }
  }
  if (action === 'effort') {
    const level = (rest[0] || '').toLowerCase()
    if (rest.length !== 1 || !EFFORTS.includes(level)) return { ok: false, error: `/diet effort <${EFFORTS.join('|')}>` }
    return { ok: true, action, targets: [], value: level, session: false }
  }
  return { ok: false, error: `unknown subcommand "${action}"` }
}

export const HELP = [
  '/diet                      open the review pane',
  '/diet status               show what is trimmed, model and effort',
  '/diet off|on <targets>     plugin:<id> mcp:<server> skill:<name> agent:<type>',
  '                           (saved to .claude/settings.local.json; add --session to skip saving)',
  '/diet model <name>         save model, pre-fill /model',
  '/diet effort <level>       save effort, pre-fill /effort',
  'Quote names with spaces: mcp:"claude.ai Slack"',
].join('\n')
