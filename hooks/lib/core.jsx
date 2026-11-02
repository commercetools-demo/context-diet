import { atom, read, update } from 'claude-code'

import { applyChange, parseSettingsText, serialize, setEffort, setModel, savedEffort, validateEffort, levelsFor } from './settings.js'
import { HELP, parseDiet } from './args.js'
import { estimate, fmt, normalizeServer, parseDetails, parseMcpList, serverOfTool } from './tokens.js'

// Every state reference is declared here: the validator reads them per file.

// Bump a tag when the stored shape changes: older stored values read as initial.
const EMPTY_BLOCK = { servers: [], plugins: [], skills: [], agents: [], commands: [] }

export const off = atom({ plugin: 'context-diet', key: 'off' }, [], { shape: 'off-1' })
export const block = atom({ plugin: 'context-diet', key: 'block' }, EMPTY_BLOCK, { shape: 'block-1' })
export const draft = atom({ plugin: 'context-diet', key: 'draft' }, [], { shape: 'draft-1' })
export const draftModel = atom({ plugin: 'context-diet', key: 'draftModel' }, '', { shape: 'dm-1' })
export const draftEffort = atom({ plugin: 'context-diet', key: 'draftEffort' }, '', { shape: 'de-1' })
export const inventory = atom({ plugin: 'context-diet', key: 'inventory' }, null, { shape: 'inv-1' })
export const info = atom({ plugin: 'context-diet', key: 'info' }, null, { shape: 'info-1' })
export const offered = atom({ plugin: 'context-diet', key: 'offered' }, [], { shape: 'offered-1' })
export const isBandShown = atom({ plugin: 'context-diet', key: 'isBandShown' }, false, { shape: 'band-1' })
export const isScanning = atom({ plugin: 'context-diet', key: 'isScanning' }, false, { shape: 'scan-1' })
export const note = atom({ plugin: 'context-diet', key: 'note' }, '', { shape: 'note-1' })

export const PANE = 'context-diet'



async function run($, argv, timeoutMs) {
  try {
    const r = await $.process.run(argv, { timeoutMs })
    return r.exitCode === 0 ? r.stdout : ''
  } catch {
    return ''
  }
}

async function runJson($, argv) {
  const out = await run($, argv, 20000)
  try {
    return JSON.parse(out)
  } catch {
    return undefined
  }
}

// Agent definitions on disk (names and description lines only).
async function diskAgents($, dir) {
  const found = []
  try {
    if (!(await $.fs.exists(dir))) return found
    for (const f of await $.fs.list(dir)) {
      if (f.kind !== 'file' || !f.name.endsWith('.md')) continue
      const text = (await $.fs.read(`${dir}/${f.name}`)).slice(0, 2000)
      const d = /^description:\s*(.+)$/m.exec(text)
      found.push({ type: f.name.replace(/\.md$/, ''), description: d ? d[1] : '' })
    }
  } catch {
    // unreadable agents folder: ignore
  }
  return found
}

// Builds the inventory. Slow (spawns `claude`): call from a background job.
export async function collect($, offeredAgents) {
  const errors = []
  const root = await $.session.root()
  const tools = await $.tool.list()
  const commands = await $.command.list()

  // MCP servers: names from `claude mcp list`, tools from $.tool.list().
  const byKey = new Map()
  for (const t of tools) {
    if (!t.mcp) continue
    const key = serverOfTool(t.name)
    if (!key) continue
    const s = byKey.get(key) || { names: [], tokens: 0 }
    s.names.push(t.name)
    s.tokens += estimate(t.name) + 1
    byKey.set(key, s)
  }
  const listed = parseMcpList(await run($, ['claude', 'mcp', 'list'], 28000))
  if (listed.length === 0) errors.push('claude mcp list gave nothing; server names come from tool names')
  const servers = []
  const seen = new Set()
  for (const l of listed) {
    const key = normalizeServer(l.name)
    const t = byKey.get(key)
    seen.add(key)
    servers.push({
      name: l.name,
      key,
      status: l.status,
      connector: l.name.startsWith('claude.ai '),
      tools: t ? t.names.length : 0,
      tokens: t ? t.tokens : 0,
    })
  }
  for (const [key, t] of byKey) {
    if (seen.has(key)) continue
    servers.push({ name: key, key, status: 'connected', connector: key.startsWith('claude_ai_'), tools: t.names.length, tokens: t.tokens })
  }

  // Plugins that apply to this project: user scope, or this project's path.
  const rawPlugins = (await runJson($, ['claude', 'plugin', 'list', '--json'])) || []
  const plugins = []
  const ids = new Set()
  for (const p of Array.isArray(rawPlugins) ? rawPlugins : []) {
    if (!p.enabled || ids.has(p.id) || p.id.split('@')[0] === 'context-diet') continue
    if (p.scope !== 'user' && !(p.projectPath && root.startsWith(p.projectPath))) continue
    ids.add(p.id)
    const name = p.id.split('@')[0]
    const details = parseDetails(await run($, ['claude', 'plugin', 'details', name], 15000))
    plugins.push({
      id: p.id,
      name,
      tokens: details.alwaysOn,
      components: details.components,
      skills: [],
      servers: Object.keys(p.mcpServers || {}).map(k => `plugin:${name}:${k}`),
    })
  }

  // Skills and commands: plugin skills are `plugin:name` with a `plugin` field.
  const skills = []
  for (const c of commands) {
    if (c.source !== 'plugin' && c.source !== 'user') continue
    if (c.name === 'probe' || c.name === 'diet') continue
    const short = c.name.includes(':') ? c.name.split(':').slice(1).join(':') : c.name
    const owner = plugins.find(p => p.name === c.plugin)
    const known = owner && owner.components[short]
    skills.push({
      name: c.name,
      plugin: c.plugin,
      tokens: known !== undefined ? known : estimate(`${c.name} ${c.description}`),
    })
    if (owner) owner.skills.push(c.name)
  }

  // Agent types: what agent.offer reported, plus definitions on disk.
  const agentMap = new Map()
  for (const a of offeredAgents) agentMap.set(a.type, a)
  for (const a of await diskAgents($, `${root}/.claude/agents`)) if (!agentMap.has(a.type)) agentMap.set(a.type, a)
  const home = await $.env.get('HOME')
  if (home) for (const a of await diskAgents($, `${home}/.claude/agents`)) if (!agentMap.has(a.type)) agentMap.set(a.type, a)
  const agents = [...agentMap.values()]
    .filter(a => a.plugin !== 'engine')
    .map(a => ({ type: a.type, plugin: a.plugin, tokens: estimate(`${a.type} ${a.description}`) }))

  return { at: await $.clock.now(), plugins, servers, skills, agents, errors }
}

export async function scanNow($) {
  await update($, isScanning, () => true)
  try {
    const inv = await collect($, await read($, offered))
    await update($, inventory, () => inv)
  } catch (err) {
    await update($, inventory, () => ({ at: 0, plugins: [], servers: [], skills: [], agents: [], errors: [`scan failed: ${err && err.message}`] }))
  }
  await update($, isScanning, () => false)
}



export const SETTINGS_PATH = '.claude/settings.local.json'

export function splitId(id) {
  const i = id.indexOf(':')
  return { kind: id.slice(0, i), name: id.slice(i + 1), id }
}

export function computeBlock(offIds, inv) {
  const b = { servers: [], plugins: [], skills: [], agents: [], commands: [] }
  const push = (list, v) => { if (!list.includes(v)) list.push(v) }
  for (const id of offIds) {
    const { kind, name } = splitId(id)
    if (kind === 'mcp') push(b.servers, normalizeServer(name))
    else if (kind === 'skill') { push(b.skills, name); push(b.commands, name) }
    else if (kind === 'agent') push(b.agents, name)
    else if (kind === 'plugin') {
      push(b.plugins, name)
      const p = inv && inv.plugins.find(x => x.name === name || x.id === name)
      if (p) {
        for (const s of p.servers) push(b.servers, normalizeServer(s))
        for (const s of p.skills) { push(b.skills, s); push(b.commands, s) }
      }
    }
  }
  return b
}

export async function loadInfo($) {
  const model = await $.session.model()
  const merged = await $.settings.read()
  const effort = savedEffort(merged, model) || (merged.model ? savedEffort(merged, merged.model) : undefined)
  const envEffort = await $.env.get('CLAUDE_CODE_EFFORT_LEVEL')
  const value = { model, effort, envEffort }
  await update($, info, () => value)
  return value
}

// Session only: nothing is written.
export async function applySession($, offIds) {
  const inv = await read($, inventory)
  const ids = [...new Set(offIds)]
  await update($, off, () => ids)
  await update($, block, () => computeBlock(ids, inv))
  await update($, draft, () => ids)
  $.ui.invalidate('tool.describe')
  $.ui.invalidate('command.describe')
}

// Writes the one settings file. Never overwrites a file that does not parse.
export async function persist($, { offT = [], onT = [], model, effort }) {
  const root = await $.session.root()
  const path = `${root}/${SETTINGS_PATH}`
  let current = {}
  try {
    if (await $.fs.exists(path)) current = parseSettingsText(await $.fs.read(path))
  } catch (err) {
    return { ok: false, notes: [`${SETTINGS_PATH} is not valid JSON (${err.message}); left untouched`] }
  }
  const inv = await read($, inventory)
  const pluginIds = {}
  for (const p of (inv && inv.plugins) || []) pluginIds[p.name] = p.id
  const pluginSkills = ((inv && inv.skills) || []).filter(s => s.plugin).map(s => s.name)
  let projectMcp = []
  try {
    if (await $.fs.exists(`${root}/.mcp.json`)) projectMcp = Object.keys(JSON.parse(await $.fs.read(`${root}/.mcp.json`)).mcpServers || {})
  } catch {
    // unreadable .mcp.json: treat every server as non-project
  }
  const { settings, notes } = applyChange(current, { off: offT, on: onT }, { pluginIds, projectMcp, pluginSkills })
  let next = settings
  if (effort) {
    const m = await $.session.model()
    const bad = validateEffort(effort, m)
    if (bad) return { ok: false, notes: [bad] }
    next = setEffort(next, effort, m)
  }
  if (model) next = setModel(next, model)
  await $.fs.write(path, serialize(next))
  return { ok: true, notes, path }
}

export async function status($) {
  const [inv, offIds, i] = [await read($, inventory), await read($, off), await loadInfo($)]
  const usage = await $.session.usage().catch(() => undefined)
  const lines = []
  lines.push(`context-diet status (all token numbers are estimates)`)
  lines.push(`model: ${i.model}   saved effort: ${i.effort || 'default'}${i.envEffort ? `   CLAUDE_CODE_EFFORT_LEVEL=${i.envEffort} overrides saved effort` : ''}`)
  if (usage && usage.context) lines.push(`context: ${JSON.stringify(usage.context)}`)
  lines.push(`disabled this session: ${offIds.length ? offIds.join(', ') : 'nothing'}`)
  if (inv) {
    const sum = (list, ids, f) => list.filter(x => ids.includes(f(x))).reduce((a, x) => a + (x.tokens || 0), 0)
    lines.push(
      `loaded: ${inv.plugins.length} plugins (${fmt(inv.plugins.reduce((a, p) => a + (p.tokens || 0), 0))} tok always-on), ` +
      `${inv.servers.length} MCP servers/connectors, ${inv.skills.length} skills, ${inv.agents.length} agent types`,
    )
    const saved = sum(inv.plugins, offIds.map(x => splitId(x).name), p => p.name) +
      sum(inv.servers, offIds.map(x => splitId(x).name), s => s.name) +
      sum(inv.skills, offIds.map(x => splitId(x).name), s => s.name)
    if (saved) lines.push(`trimmed so far: ${fmt(saved)} tok (estimate)`)
    for (const e of inv.errors) lines.push(`note: ${e}`)
  } else {
    lines.push('inventory: not scanned yet (open /diet to scan)')
  }
  return lines.join('\n')
}

export async function setNote($, text) {
  await update($, note, () => text)
}

export async function clearDraftModel($) {
  await update($, draftModel, () => '')
  await update($, draftEffort, () => '')
}

// Shared by the pane's two buttons and by `/diet off|on|model|effort`.
// change: { offIds, onIds, model, effort, save }. offIds/onIds are deltas on
// the session's disabled set. Returns the lines to show.
export async function commit($, { offIds = [], onIds = [], model, effort, save }) {
  const lines = []
  const current = await read($, off)
  const next = [...new Set([...current.filter(id => !onIds.includes(id)), ...offIds])]
  await applySession($, next)
  const i = await loadInfo($)
  const fills = []

  if (save) {
    const relevant = id => !id.startsWith('agent:')
    const r = await persist($, {
      offT: offIds.filter(relevant).map(splitId),
      onT: onIds.filter(relevant).map(splitId),
      model: model && model !== i.model ? model : undefined,
      effort,
    })
    for (const n of r.notes) lines.push(n)
    if (!r.ok) return { ok: false, lines }
    lines.push(`saved to ${SETTINGS_PATH}`)
    const touchesReload = [...offIds, ...onIds].some(id => id.startsWith('plugin:') || id.startsWith('mcp:'))
    if (touchesReload) fills.push('/reload-plugins')
    if (i.envEffort && effort) lines.push(`warning: CLAUDE_CODE_EFFORT_LEVEL=${i.envEffort} is set and beats the saved effort`)
  }
  if (effort) fills.push(`/effort ${effort}`)
  if (model) fills.push(`/model ${model}`)
  if (fills.length) {
    await $.prompt.fill({ text: fills[0] })
    lines.push(`pre-filled ${fills[0]}, press Enter to run it` + (fills.length > 1 ? `; then also run: ${fills.slice(1).join(', ')}` : ''))
  }
  const skills = [...offIds, ...onIds].some(id => id.startsWith('skill:'))
  if (skills) lines.push('skills: disabling denies the Skill tool and hides the command, but the skill listing tokens stay until a reload or settings change')
  return { ok: true, lines }
}

export async function commitDraft($, save) {
  const draftIds = await read($, draft)
  const current = await read($, off)
  const model = await read($, draftModel)
  const effort = await read($, draftEffort)
  const offIds = draftIds.filter(id => !current.includes(id) || save)
  const onIds = current.filter(id => !draftIds.includes(id))
  const r = await commit($, { offIds, onIds, model: model || undefined, effort: effort || undefined, save })
  await setNote($, r.lines.join('\n'))
  $.ui.toast(r.ok ? (save ? 'context-diet: applied and saved' : 'context-diet: applied for this session') : `context-diet: ${r.lines[0]}`)
  return r
}



// Claude Code's own servers: turning these off breaks the host app.
const ANTHROPIC_DOCS = ['docx', 'pdf', 'pptx', 'import-memory', 'xlsx']
const SKILL_GROUPS = [
  { key: 'ct', label: 'commercetools-ai-plugin', has: n => n.startsWith('commercetools:') },
  { key: 'anth', label: 'anthropic skills', has: n => ANTHROPIC_DOCS.includes(n.slice(n.lastIndexOf(':') + 1)) },
]
const REQUIRED_SERVER = /^(ccd_.+|mcp-registry)$/

function toggle(list, id) {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}

async function review($) {
  await update($, isBandShown, () => false)
  await openPane($)
}

function skip($) {
  return update($, isBandShown, () => false)
}

async function never($) {
  await $.store.set(`never:${await $.session.root()}`, true)
  await update($, isBandShown, () => false)
  $.ui.toast('context-diet: will not ask again in this project')
}

export async function renderBand($, e, next) {
  if (e.props.hasSurvey || !(await read($, isBandShown))) return next(e)
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box borderStyle="round" borderColor="claude" paddingX={1} gap={1} flexWrap="wrap" alignItems="center">
      <Text bold color="claude">Context diet</Text>
      <Text>Loaded context could be trimmed.</Text>
      <Box gap={1}>
        <Button key="review" label="Review" variant="primary" onPress={() => review($)} />
        <Button key="skip" label="Skip" onPress={() => skip($)} />
        <Button key="never" label="Never for this project" dimColor onPress={() => never($)} />
      </Box>
    </Box>
  )
}

function sumTokens(inv, ids) {
  const plugins = ids.filter(i => i.startsWith('plugin:')).map(i => i.slice(7))
  let total = 0
  for (const id of ids) {
    const { kind, name } = splitId(id)
    if (kind === 'plugin') total += (inv.plugins.find(p => p.name === name) || {}).tokens || 0
    // a plugin's skills and servers are already inside the plugin's figure
    else if (kind === 'skill') {
      const sk = inv.skills.find(x => x.name === name)
      if (sk && !(sk.plugin && plugins.includes(sk.plugin))) total += sk.tokens
    } else if (kind === 'mcp') total += (inv.servers.find(x => x.name === name) || {}).tokens || 0
    else if (kind === 'agent') total += (inv.agents.find(x => x.type === name) || {}).tokens || 0
  }
  return total
}

export async function renderPane($, e) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const inv = await read($, inventory)
  const ids = await read($, draft)
  const applied = await read($, off)
  const scanning = await read($, isScanning)
  const i = await read($, info)
  const dEffort = await read($, draftEffort)
  const msg = await read($, note)

  // Checked ([x]) means kept, so "select all" clears the ids from the off list.
  const Section = (key, title, hint, children, picks, onlyNecessary, groups) => (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginTop={1}>
      <Text bold>{title}</Text>
      {hint ? <Text dimColor>{hint}</Text> : null}
      {picks && picks.length ? (
        <Box gap={1} flexWrap="wrap">
          <Button key={`${key}-all`} label="Select all" onPress={() => update($, draft, l => l.filter(x => !picks.includes(x)))} />
          <Button key={`${key}-none`} label="Select none" onPress={() => update($, draft, l => [...l.filter(x => !picks.includes(x)), ...picks])} />
          {(groups || []).map(g => {
            const members = picks.filter(x => g.has(x.slice(x.indexOf(':') + 1)))
            if (!members.length) return null
            // Toggled when every member is checked (kept); pressing flips the whole group.
            const isOn = members.every(x => !ids.includes(x))
            return (
              <Button key={`${key}-${g.key}`} label={`${isOn ? '[x]' : '[ ]'} ${g.label}`} variant={isOn ? 'primary' : 'secondary'}
                onPress={() => update($, draft, l => (isOn ? [...l.filter(x => !members.includes(x)), ...members] : l.filter(x => !members.includes(x))))} />
            )
          })}
          {onlyNecessary ? (
            <Button key={`${key}-min`} label="Only necessary" onPress={() => update($, draft, l => [...l.filter(x => !picks.includes(x)), ...picks.filter(x => !REQUIRED_SERVER.test(x.slice(4)))])} />
          ) : null}
        </Box>
      ) : null}
      {children}
    </Box>
  )

  // One toggle row: checkbox and name on the left, the estimate on the right.
  const Row = (id, name, tokens, extra) => {
    const isOff = ids.includes(id)
    return (
      <Box key={`row-${id}`} justifyContent="space-between" gap={2}>
        <Box flexShrink={1} flexGrow={1} minWidth={0}>
          <Button key={id} plain onPress={() => update($, draft, l => toggle(l, id))}>
            <Text color={isOff ? 'error' : 'success'}>{isOff ? '[ ]' : '[x]'}</Text>
            <Text wrap="truncate-end" dimColor={isOff} strikethrough={isOff}>{` ${name}`}</Text>
          </Button>
        </Box>
        <Box flexShrink={0}>
          <Text wrap="truncate-end" dimColor>{`${extra ? extra + '   ' : ''}${fmt(tokens)} tok`}</Text>
        </Box>
      </Box>
    )
  }

  const Chips = (label, options, picked, onPick, prefix) => (
    <Box gap={1} alignItems="center">
      <Text dimColor>{label}</Text>
      {options.map(o => (
        <Button key={`${prefix}-${o}`} label={o} variant={picked === o ? 'primary' : 'secondary'} onPress={() => onPick(o)} />
      ))}
    </Box>
  )

  const effortLevels = levelsFor(i && i.model)
  const picked = dEffort || (i && i.effort) || ''
  const saving = inv ? sumTokens(inv, ids) : 0
  const allIds = inv ? [...inv.plugins.map(p => `plugin:${p.name}`), ...inv.servers.map(x => `mcp:${x.name}`), ...inv.skills.map(x => `skill:${x.name}`), ...inv.agents.map(x => `agent:${x.type}`)] : []
  const kept = inv ? Math.max(0, sumTokens(inv, allIds) - saving) : 0

  const sections = []
  sections.push(
    Section('model', 'Model and effort', null, (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text dimColor>model</Text>
          <Text bold>{(i && i.model) || '?'}</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>saved effort</Text>
          <Text bold>{(i && i.effort) || 'model default'}</Text>
          {dEffort ? <Text color="warning">{`-> ${dEffort}`}</Text> : null}
        </Box>
        <Text dimColor>Saved value only: it misses /effort changes made in this session.</Text>
        {i && i.envEffort ? <Text color="warning">{`CLAUDE_CODE_EFFORT_LEVEL=${i.envEffort} is set and beats the saved effort.`}</Text> : null}
        {effortLevels.length ? Chips('effort', effortLevels, picked, l => update($, draftEffort, () => l), 'eff') : null}
        <Text dimColor>To change the model: /diet model name. Applying pre-fills /effort for you to run.</Text>
      </Box>
    )),
  )

  if (!inv) {
    sections.push(
      <Box key="scan" marginTop={1}>
        <Text dimColor>{scanning ? 'Scanning what is loaded...' : 'Not scanned yet.'}</Text>
      </Box>,
    )
  } else {
    const connectors = inv.servers.filter(s => s.connector)
    const servers = inv.servers.filter(s => !s.connector)
    const none = text => <Text dimColor>{text}</Text>
    sections.push(
      Section('plugins', 'Plugins', `${inv.plugins.length} loaded`,
        inv.plugins.length === 0 ? none('none') : inv.plugins.map(p => Row(`plugin:${p.name}`, p.name, p.tokens, `${p.skills.length} skills`)),
        inv.plugins.map(p => `plugin:${p.name}`)),
    )
    sections.push(
      Section('mcp', 'MCP servers', 'tool names only count; definitions load on demand',
        servers.length === 0 ? none('none') : servers.map(s => Row(`mcp:${s.name}`, s.name, s.tokens, `${s.tools} tools`)),
        servers.map(s => `mcp:${s.name}`), true),
    )
    sections.push(
      Section('conn', 'claude.ai connectors', null, (
        <Box flexDirection="column">
          {connectors.length === 0 ? none('none connected') : connectors.map(s => Row(`mcp:${s.name}`, s.name, s.tokens, `${s.tools} tools`))}
          {connectors.length ? none('In the Desktop app, remove them for good under Customize - Connectors.') : null}
        </Box>
      ), connectors.map(s => `mcp:${s.name}`)),
    )
    sections.push(
      Section('skills', 'Skills', 'unchecking denies the skill; listing tokens stay until reload',
        inv.skills.length === 0 ? none('none') : inv.skills.map(s => Row(`skill:${s.name}`, s.name, s.tokens)),
        inv.skills.map(s => `skill:${s.name}`), false, SKILL_GROUPS),
    )
    sections.push(
      Section('agents', 'Agents', null,
        inv.agents.length === 0 ? none('none seen yet (types appear once Claude lists them)') : inv.agents.map(a => Row(`agent:${a.type}`, a.type, a.tokens)),
        inv.agents.map(a => `agent:${a.type}`)),
    )
    for (const err of inv.errors) sections.push(<Text key={`err-${err}`} dimColor>{`note: ${err}`}</Text>)
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Text bold color="claude" size="heading">Context diet</Text>
        <Text dimColor>all token figures are estimates</Text>
      </Box>
      <Box gap={1} marginTop={1} alignItems="center" flexWrap="wrap">
        <Button key="apply" label="Apply for this session" variant="primary" onPress={() => commitDraft($, false)} />
        <Button key="save" label="Save for this project" onPress={() => commitDraft($, true)} />
        <Button key="close" label="Close" role="dismiss" dimColor onPress={() => $.ui.close({ id: PANE })} />
      </Box>
      {inv ? (
        <Box gap={1}>
          <Text bold>Total context (checked)</Text>
          <Text bold color="claude">{`~${fmt(kept)} tok`}</Text>
          <Text dimColor>estimate</Text>
        </Box>
      ) : null}
      <Box gap={1}>
        <Text>{ids.length ? `${ids.length} selected to turn off` : 'nothing selected to turn off'}</Text>
        {ids.length ? <Text color="success">{`saves about ${fmt(saving)} tok (estimate)`}</Text> : null}
        <Text dimColor>{applied.length ? `| ${applied.length} off in this session` : ''}</Text>
      </Box>
      {msg ? <Box marginTop={1}><Text color="warning">{msg}</Text></Box> : null}
      {sections}
    </Box>
  )
}

export async function openPane($) {
  await update($, isBandShown, () => false)
  await loadInfo($)
  await update($, draft, () => [])
  const current = await read($, off)
  await update($, draft, () => current)
  await update($, draftModel, () => '')
  await update($, draftEffort, () => '')
  await update($, note, () => '')
  const r = await $.ui.open({ id: PANE, title: 'Context diet', focus: true })
  void scanNow($)
  return r
}

// ---- hook bodies (register.js stays thin: state is read only in this file)

const WHY = 'Disabled for this session by context-diet. Re-enable with /diet on, or ask the user.'

// Called from session.start: a fresh session (no turns, no rows) stands for
// `startup`. (`source` is kept for a caller that has one.)
export async function maybeAsk($, source) {
  // The surface is not required here: a host such as the Desktop app may not
  // have one yet when session.start fires. The band only draws where there is
  // an AbovePrompt, and the delayed check below decides the rest.
  if (source !== undefined && source !== 'startup') return
  if (source === undefined && ((await $.session.turns()) > 0 || (await $.session.messages()).length > 0)) return
  const root = await $.session.root()
  const askedKey = `asked:${await $.session.id()}`
  if ((await $.store.get(askedKey)) || (await $.store.get(`never:${root}`))) return
  await $.store.set(askedKey, true)
  await update($, isBandShown, () => true)
  // Later, in the background: is anything drawn yet? A host may bind its
  // drawing session after session.start, so look a few times.
  $.clock.after(1500, () => { void afterStart($, 0) })
}

async function afterStart($, tries) {
  const surface = await $.session.surface()
  if (!surface) {
    // `-p` runs never get one; a Desktop session may get one a moment later.
    if (tries < 15) $.clock.after(2000, () => { void afterStart($, tries + 1) })
    return
  }
  if (surface === 'vscode') {
    await update($, isBandShown, () => false)
    $.ui.toast('context-diet: run /diet to review loaded plugins, MCP servers and skills', { timeoutMs: 10000 })
    $.ui.status('/diet to trim context')
  }
  await scanNow($)
}

export async function describeTool($, e, next) {
  const b = await read($, block)
  const key = serverOfTool(e.tool)
  if (key && b.servers.includes(key)) return { description: WHY, isDeferred: true }
  return next(e)
}

export async function guardCall($, e, next) {
  const b = await read($, block)
  const key = serverOfTool(e.tool)
  if (key && b.servers.includes(key)) return { deny: `${e.tool}: ${WHY}` }
  if (e.tool === 'Skill') {
    const name = String(e.skill || '')
    const plugin = name.includes(':') ? name.split(':')[0] : undefined
    if (b.skills.includes(name) || (plugin && b.plugins.includes(plugin))) return { deny: `Skill ${name}: ${WHY}` }
  }
  if (e.tool === 'Agent' || e.tool === 'Task') {
    const type = String(e.subagent_type || '')
    if (type && b.agents.includes(type)) return { deny: `Agent ${type}: ${WHY}` }
  }
  return next(e)
}

export async function offerAgent($, e, next) {
  const seen = await read($, offered)
  if (!seen.some(a => a.type === e.agent) && e.provider.plugin !== 'engine') {
    await update($, offered, l => [...l, { type: e.agent, description: e.description, plugin: e.provider.plugin }])
  }
  const b = await read($, block)
  if (b.agents.includes(e.agent) || b.plugins.includes(e.provider.plugin)) return { isOffered: false }
  return next(e)
}

export async function describeCommand($, e, next) {
  const b = await read($, block)
  if (b.commands.includes(e.command)) return { ...(await next(e)), isHidden: true }
  return next(e)
}

export async function runDiet($, e) {
  const p = parseDiet(e.args)
  if (!p.ok) return { text: `/diet: ${p.error}\n${HELP}` }
  if (p.action === 'help') return { text: HELP }
  if (p.action === 'status') {
    const text = await status($)
    if (!(await $.session.surface())) return { text }
    $.ui.log(text)
    return { text: 'context-diet status written to the log above' }
  }
  if (p.action === 'open') {
    const r = await openPane($)
    return { text: r.isPlaced ? 'Context diet pane opened.' : `The pane could not be placed (${r.reason}). Use /diet status and /diet off|on instead.` }
  }
  if (!(await read($, inventory))) await scanNow($)
  const ids = p.targets.map(t => t.id)
  const result =
    p.action === 'off' ? await commit($, { offIds: ids, save: !p.session })
    : p.action === 'on' ? await commit($, { onIds: ids, save: !p.session })
    : p.action === 'model' ? await commit($, { model: p.value, save: true })
    : await commit($, { effort: p.value, save: true })
  await update($, isBandShown, () => false)
  return { text: (result.ok ? '' : 'Not applied. ') + (result.lines.join('\n') || 'Done.') }
}
