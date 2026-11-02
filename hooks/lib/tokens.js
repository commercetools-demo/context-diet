// Token estimates. Nothing here is exact: chars / 4, or what
// `claude plugin details` projects. Every number shown is labelled estimate.

export function estimate(text) {
  return Math.ceil((text || '').length / 4)
}

export function fmt(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return '?'
  return n >= 1000 ? `~${(n / 1000).toFixed(1)}k` : `~${n}`
}

function toNumber(s) {
  const m = /^~?\s*([\d,.]+)\s*(k?)/i.exec(s)
  if (!m) return undefined
  const n = parseFloat(m[1].replace(/,/g, ''))
  return Math.round(m[2] ? n * 1000 : n)
}

// Parses `claude plugin details <name>` -> { alwaysOn, components: { name: alwaysOn } }
export function parseDetails(stdout) {
  const out = { alwaysOn: undefined, components: {} }
  const total = /Always-on:\s*(~?[\d,.]+k?)/i.exec(stdout)
  if (total) out.alwaysOn = toNumber(total[1])
  const lines = stdout.split('\n')
  const start = lines.findIndex(l => /^Per-component/i.test(l))
  if (start >= 0) {
    for (const line of lines.slice(start + 2)) {
      const m = /^\s{2}(\S+)\s+(~[\d,.]+k?)\s+(~[\d,.]+k?)\s*$/.exec(line)
      if (m) out.components[m[1]] = toNumber(m[2])
      else if (!line.trim()) break
    }
  }
  return out
}

// Parses `claude mcp list` -> [{ name, status, ok }]
export function parseMcpList(stdout) {
  const servers = []
  for (const line of stdout.split('\n')) {
    const colon = /^(.+?): (\S.*)$/.exec(line)
    if (!colon) continue
    const rest = colon[2]
    const dash = rest.lastIndexOf(' - ')
    if (dash < 0) continue
    const status = rest.slice(dash + 3).trim()
    servers.push({ name: colon[1], status, ok: /Connected/i.test(status) })
  }
  return servers
}

// How the model-facing tool name spells a server: mcp__<this>__<tool>
export function normalizeServer(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function serverOfTool(toolName) {
  const m = /^mcp__(.+?)__/.exec(toolName)
  return m ? m[1] : undefined
}
