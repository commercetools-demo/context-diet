import { expect, mock, test } from 'claude-code/testing'

const BAND = { plugin: 'context-diet', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} } } as const

function engine(on: any, surface: string | null | (() => string | null), store: Record<string, unknown> = {}, turns = 0, toasts: string[] = []) {
  on('command.register', () => ({ value: { command: 'diet' } }))
  on('session.surface', () => ({ value: typeof surface === 'function' ? surface() : surface }))
  on('session.turns', () => ({ value: turns }))
  on('session.messages', () => ({ value: [] }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => { store[e.key] = e.value; return { value: undefined } })
  const clock = mock.clock(on)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.toast', (_: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  // the engine's own drawing, beneath the mod
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return clock
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band shows once per session and stays dismissed after a reload`, async ($, on) => {
    const store: Record<string, unknown> = {}
    const clock = engine(on, surface, store)
    await $.session.start({ cwd: '/proj', surface, isInteractive: true })
    await clock.advance(2000)
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /could be trimmed/ }))?.text).toContain('Loaded context could be trimmed')
    expect(await ui.find({ type: 'Button', key: 'review' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'never' })).toBeDefined()
    expect(store['asked:sess-1']).toBe(true)
    await ui.press({ plugin: 'context-diet', key: 'skip' })
    await ui.unmount()
    // a hot reload re-fires session.start: the band stays dismissed
    await $.session.start({ cwd: '/proj', surface, isInteractive: true })
    const again = await $.ui.mount({ ...BAND, surface })
    expect(await again.find({ type: 'Button', key: 'review' })).toBeUndefined()
    await again.unmount()
  })
}

test('vscode: no band, a toast pointing to /diet', async ($, on) => {
  const toasts: string[] = []
  const clock = engine(on, 'vscode', {}, 0, toasts)
  await $.session.start({ cwd: '/proj', surface: 'vscode', isInteractive: true })
  await clock.advance(2000)
  expect(toasts.join(' ')).toContain('/diet')
  // the background scan has settled before the test ends
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.unmount()
})

test('a resumed session (turns already happened) is not asked', async ($, on) => {
  const store: Record<string, unknown> = {}
  engine(on, 'terminal', store, 4)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'review' })).toBeUndefined()
  expect(store['asked:sess-1']).toBeUndefined()
  await ui.unmount()
})

test('"Never for this project" is remembered', async ($, on) => {
  engine(on, 'terminal', { 'never:/proj': true })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'review' })).toBeUndefined()
  await ui.unmount()
})

test('a host with no surface (claude -p) scans nothing and toasts nothing', async ($, on) => {
  const toasts: string[] = []
  let spawned = 0
  const clock = engine(on, null, {}, 0, toasts)
  on('process.run', () => { spawned += 1; return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })
  await clock.advance(60000)
  expect(spawned).toBe(0)
  expect(toasts).toEqual([])
})

test('a surface that binds after session.start (Desktop) is still picked up', async ($, on) => {
  const toasts: string[] = []
  let surface: string | null = null
  const clock = engine(on, () => surface, {}, 0, toasts)
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: true })
  await clock.advance(3000)
  expect(toasts).toEqual([])
  surface = 'vscode'
  await clock.advance(4000)
  expect(toasts.join(' ')).toContain('/diet')
})

// ---- /diet and the session-only hooks

const MCP_LIST = 'Checking MCP server health…\n\nclaude.ai Slack: https://mcp.slack.com/mcp (HTTP) - ✔ Connected\nnimbus: npx nimbus (stdio) - ✔ Connected\n'
const PLUGINS = JSON.stringify([{ id: 'foo@mkt', scope: 'user', enabled: true, mcpServers: {} }])
const DETAILS = 'foo 1\n\nProjected token cost\n  Always-on:   ~300 tok   added to every session\n\nPer-component (rounded)\n  component   always-on  on-invoke\n  helper   ~300   ~1k\n\n'

function full(on: any, files: Record<string, string>, fills: string[] = []) {
  const clock = engine(on, 'terminal', {})
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('env.get', () => ({ value: undefined }))
  on('tool.list', () => ({ value: [
    { name: 'mcp__claude_ai_Slack__send', description: 'x', mcp: true },
    { name: 'mcp__nimbus__get', description: 'x', mcp: true },
    { name: 'Bash', description: 'x', mcp: false },
  ] }))
  on('command.list', () => ({ value: [{ name: 'foo:helper', description: 'does things', source: 'plugin', plugin: 'foo' }, { name: 'find-skills', description: 'finds', source: 'user' }] }))
  on('process.run', (_: any, e: any) => {
    const argv: string[] = e.argv
    const stdout = argv[1] === 'mcp' ? MCP_LIST : argv[2] === 'list' ? PLUGINS : DETAILS
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.read', (_: any, e: any) => ({ value: files[e.path] }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('prompt.fill', (_: any, e: any) => { fills.push(e.text); return { isFilled: true, text: e.text, cursor: e.text.length } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.usage', () => ({ value: {} }))
  on('tool.call', () => ({ result: {} }))
  on('command.describe', (_: any, e: any) => ({ description: e.description, isHidden: false }))
  on('agent.offer', () => ({ isOffered: true }))
  on('tool.describe', (_: any, e: any) => ({ description: e.description }))
  return clock
}

const SETTINGS = '/proj/.claude/settings.local.json'

test('/diet off and on round-trip the settings file and keep other keys', async ($, on) => {
  const files: Record<string, string> = { [SETTINGS]: JSON.stringify({ theme: 'x', permissions: { allow: ['Bash(ls)'] } }) }
  const fills: string[] = []
  full(on, files, fills)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  const run = (args: string) => $.command.run({ command: 'diet', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  await run('off mcp:"claude.ai Slack" plugin:foo skill:find-skills')
  let saved = JSON.parse(files[SETTINGS])
  expect(saved.theme).toBe('x')
  expect(saved.deniedMcpServers).toEqual([{ serverName: 'claude.ai Slack' }])
  expect(saved.enabledPlugins).toEqual({ 'foo@mkt': false })
  expect(saved.skillOverrides).toEqual({ 'find-skills': 'off' })
  expect(fills).toEqual(['/reload-plugins'])

  // the session-only hooks now refuse that server, its tools and the plugin's skill
  const slack = await $.tool.describe({ tool: 'mcp__claude_ai_Slack__send', description: 'x', provider: { plugin: 'mcp:claude.ai Slack', tier: 'user' } } as any)
  expect(slack.description).toContain('Disabled for this session by context-diet')
  expect(slack.isDeferred).toBe(true)
  const nimbus = await $.tool.describe({ tool: 'mcp__nimbus__get', description: 'x', provider: { plugin: 'mcp:nimbus', tier: 'user' } } as any)
  expect(nimbus.description).toBe('x')

  await run('on mcp:"claude.ai Slack" plugin:foo skill:find-skills')
  saved = JSON.parse(files[SETTINGS])
  expect(saved).toEqual({ theme: 'x', permissions: { allow: ['Bash(ls)'] } })
})

test('/diet effort and model write the right keys and pre-fill the command', async ($, on) => {
  const files: Record<string, string> = { [SETTINGS]: JSON.stringify({ modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' } } }) }
  const fills: string[] = []
  full(on, files, fills)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const run = (args: string) => $.command.run({ command: 'diet', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })

  await run('effort high')
  const saved = JSON.parse(files[SETTINGS])
  expect(saved.effortLevel).toBe('high')
  expect(saved.modelSettings['claude-sonnet-5-5'].effortLevel).toBe('high')
  expect(fills).toEqual(['/effort high'])

  const bad = await run('effort turbo')
  expect(bad.text).toContain('/diet effort')
  await run('model opus')
  expect(JSON.parse(files[SETTINGS]).model).toBe('opus')
  expect(fills[fills.length - 1]).toBe('/model opus')
})

test('an invalid settings file is left untouched', async ($, on) => {
  const files: Record<string, string> = { [SETTINGS]: '{ not json' }
  full(on, files)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'diet', args: 'off mcp:nimbus', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(files[SETTINGS]).toBe('{ not json')
  expect(r.text).toContain('not valid JSON')
})

test('--session changes nothing on disk, and the call is denied with a clear message', async ($, on) => {
  const files: Record<string, string> = {}
  full(on, files)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'diet', args: 'off mcp:nimbus --session', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(files[SETTINGS]).toBeUndefined()
  const denied = await $.tool.call({ tool: 'mcp__nimbus__get' } as any)
  expect(JSON.stringify(denied)).toContain('Disabled for this session by context-diet')
})

const PANE = { plugin: 'context-diet', component: 'Pane', requestId: 'context-diet', props: { title: 'Context diet', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

test('the pane lists real inventory with estimates, and Save writes the file', async ($, on) => {
  const files: Record<string, string> = { [SETTINGS]: JSON.stringify({ keep: 1 }) }
  const fills: string[] = []
  full(on, files, fills)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const run = (args: string) => $.command.run({ command: 'diet', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  await run('on mcp:none --session') // scans the inventory
  await run('')

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'mcp:nimbus' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'mcp:claude.ai Slack' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'plugin:foo' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /~300 tok/ }))?.text).toContain('~300 tok')
    expect((await ui.find({ type: 'Text', text: /estimates/ }))?.text).toContain('estimates')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'context-diet', key: 'mcp:nimbus' })
  expect((await ui.find({ type: 'Button', key: 'mcp:nimbus' }))?.text).toContain('[ ]')
  await ui.press({ plugin: 'context-diet', key: 'save' })
  expect(JSON.parse(files[SETTINGS])).toEqual({ keep: 1, deniedMcpServers: [{ serverName: 'nimbus' }] })
  await ui.unmount()
})
