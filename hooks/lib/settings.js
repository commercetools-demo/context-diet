// Pure helpers for .claude/settings.local.json. No $ calls: tested alone.

export const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

// Throws on invalid JSON so a broken file is never overwritten.
export function parseSettingsText(text) {
  if (!text || !text.trim()) return {}
  const v = JSON.parse(text)
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('settings file is not a JSON object')
  return v
}

export function serialize(settings) {
  return JSON.stringify(settings, null, 2) + '\n'
}

function clone(o) {
  return JSON.parse(JSON.stringify(o))
}

// Which levels a model takes. Unknown models get the full list: Claude Code
// does the final check. Haiku models take no effort setting.
export function levelsFor(model) {
  const m = (model || '').toLowerCase()
  if (m.includes('haiku')) return []
  return LEVELS
}

export function validateEffort(level, model) {
  const ok = levelsFor(model)
  if (ok.length === 0) return `model ${model} takes no effort setting`
  if (!ok.includes(level)) return `${level} is not valid for ${model} (${ok.join(', ')})`
  return undefined
}

// ctx: { pluginIds: { name: 'name@marketplace' }, projectMcp: string[], pluginSkills: string[] }
// change: { off: [{kind,name}], on: [{kind,name}] }
// -> { settings, notes }  (settings is a new object)
export function applyChange(settings, change, ctx = {}) {
  const s = clone(settings)
  const notes = []
  const pluginIds = ctx.pluginIds || {}
  const projectMcp = new Set(ctx.projectMcp || [])
  const pluginSkills = new Set(ctx.pluginSkills || [])

  const denied = () => (s.deniedMcpServers = Array.isArray(s.deniedMcpServers) ? s.deniedMcpServers : [])
  const hasDenied = n => denied().some(e => e && e.serverName === n)
  const listWithout = (key, n) => {
    if (Array.isArray(s[key])) s[key] = s[key].filter(x => x !== n)
    if (Array.isArray(s[key]) && s[key].length === 0) delete s[key]
  }

  for (const t of change.off || []) {
    if (t.kind === 'plugin') {
      const id = t.name.includes('@') ? t.name : pluginIds[t.name]
      if (!id) { notes.push(`plugin ${t.name}: unknown id, not saved`); continue }
      s.enabledPlugins = { ...(s.enabledPlugins || {}), [id]: false }
    } else if (t.kind === 'mcp') {
      if (!hasDenied(t.name)) denied().push({ serverName: t.name })
      if (projectMcp.has(t.name)) {
        s.disabledMcpjsonServers = Array.isArray(s.disabledMcpjsonServers) ? s.disabledMcpjsonServers : []
        if (!s.disabledMcpjsonServers.includes(t.name)) s.disabledMcpjsonServers.push(t.name)
      }
    } else if (t.kind === 'skill') {
      if (pluginSkills.has(t.name) || t.name.includes(':')) {
        notes.push(`skill ${t.name}: belongs to a plugin, so only this session is affected; turn off the whole plugin to save`)
      } else {
        s.skillOverrides = { ...(s.skillOverrides || {}), [t.name]: 'off' }
      }
    } else if (t.kind === 'agent') {
      notes.push(`agent ${t.name}: no settings key, this session only`)
    }
  }

  for (const t of change.on || []) {
    if (t.kind === 'plugin') {
      const id = t.name.includes('@') ? t.name : pluginIds[t.name]
      if (id && s.enabledPlugins && id in s.enabledPlugins) {
        delete s.enabledPlugins[id]
        if (Object.keys(s.enabledPlugins).length === 0) delete s.enabledPlugins
      }
    } else if (t.kind === 'mcp') {
      if (Array.isArray(s.deniedMcpServers)) {
        s.deniedMcpServers = s.deniedMcpServers.filter(e => !(e && e.serverName === t.name))
        if (s.deniedMcpServers.length === 0) delete s.deniedMcpServers
      }
      listWithout('disabledMcpjsonServers', t.name)
    } else if (t.kind === 'skill') {
      if (s.skillOverrides && t.name in s.skillOverrides) {
        delete s.skillOverrides[t.name]
        if (Object.keys(s.skillOverrides).length === 0) delete s.skillOverrides
      }
    }
  }
  return { settings: s, notes }
}

// Writes `effortLevel`, and the model's own modelSettings entry when present
// (that entry beats the top-level key).
export function setEffort(settings, level, model) {
  const s = clone(settings)
  s.effortLevel = level
  if (model && s.modelSettings && s.modelSettings[model] && typeof s.modelSettings[model] === 'object') {
    s.modelSettings[model].effortLevel = level
  }
  return s
}

export function setModel(settings, model) {
  const s = clone(settings)
  s.model = model
  return s
}

// What the merged settings say about effort for a model: modelSettings first.
export function savedEffort(merged, model) {
  const ms = merged && merged.modelSettings
  if (ms && model && ms[model] && ms[model].effortLevel) return ms[model].effortLevel
  return merged ? merged.effortLevel : undefined
}
