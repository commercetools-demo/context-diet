import { expect, test } from 'claude-code/testing'

import { parseDiet, tokenize } from '../hooks/lib/args.js'
import { applyChange, parseSettingsText, serialize, setEffort, validateEffort, savedEffort } from '../hooks/lib/settings.js'
import { normalizeServer, parseDetails, parseMcpList, serverOfTool } from '../hooks/lib/tokens.js'

test('tokenizer groups quotes, even inside a word', () => {
  expect(tokenize('off mcp:"claude.ai Slack" plugin:a')).toEqual(['off', 'mcp:claude.ai Slack', 'plugin:a'])
  expect(tokenize("on 'a b'  c")).toEqual(['on', 'a b', 'c'])
  expect(tokenize('  ')).toEqual([])
  expect(() => tokenize('off "oops')).toThrow()
})

test('parseDiet: every subcommand', () => {
  expect(parseDiet('')).toMatchObject({ ok: true, action: 'open' })
  expect(parseDiet('status')).toMatchObject({ ok: true, action: 'status' })
  const off = parseDiet('off plugin:x@m mcp:"claude.ai Slack" skill:a:b agent:Explore --session')
  expect(off).toMatchObject({ ok: true, action: 'off', session: true })
  expect((off as any).targets.map((t: any) => t.id)).toEqual(['plugin:x@m', 'mcp:claude.ai Slack', 'skill:a:b', 'agent:Explore'])
  expect(parseDiet('on mcp:foo')).toMatchObject({ ok: true, action: 'on', session: false })
  expect(parseDiet('model opus')).toMatchObject({ ok: true, action: 'model', value: 'opus' })
  expect(parseDiet('effort HIGH')).toMatchObject({ ok: true, action: 'effort', value: 'high' })
})

test('parseDiet: rejects bad input with a reason', () => {
  for (const bad of ['off', 'off foo', 'off thing:x', 'off mcp:', 'effort turbo', 'effort', 'model', 'frobnicate', 'off "x']) {
    expect(parseDiet(bad)).toMatchObject({ ok: false })
  }
})

test('settings: off then on round-trips and keeps unrelated keys', () => {
  const start = { theme: 'x', permissions: { allow: ['Bash(ls)'] } }
  const targets = [
    { kind: 'mcp', name: 'claude.ai Slack' },
    { kind: 'plugin', name: 'foo' },
    { kind: 'skill', name: 'find-skills' },
  ]
  const ctx = { pluginIds: { foo: 'foo@mkt' } }
  const off = applyChange(start, { off: targets }, ctx).settings as any
  expect(off.theme).toBe('x')
  expect(off.deniedMcpServers).toEqual([{ serverName: 'claude.ai Slack' }])
  expect(off.enabledPlugins).toEqual({ 'foo@mkt': false })
  expect(off.skillOverrides).toEqual({ 'find-skills': 'off' })
  // idempotent
  expect(applyChange(off, { off: targets }, ctx).settings).toEqual(off)
  const back = applyChange(off, { on: targets }, ctx).settings
  expect(back).toEqual(start)
})

test('settings: plugin skills and agents are not persisted, project .mcp.json servers also go to disabledMcpjsonServers', () => {
  const r = applyChange({}, { off: [{ kind: 'skill', name: 'p:s' }, { kind: 'agent', name: 'Explore' }, { kind: 'mcp', name: 'local' }] }, { projectMcp: ['local'] })
  expect(r.settings).toEqual({ deniedMcpServers: [{ serverName: 'local' }], disabledMcpjsonServers: ['local'] })
  expect(r.notes.length).toBe(2)
})

test('settings: effort writes the model entry when present, validates levels', () => {
  const s = setEffort({ modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } }, effortLevel: 'low' }, 'high', 'claude-opus-5-5') as any
  expect(s.effortLevel).toBe('high')
  expect(s.modelSettings['claude-opus-5-5'].effortLevel).toBe('high')
  expect((setEffort({}, 'high', 'claude-sonnet-5-5') as any).modelSettings).toBeUndefined()
  expect(validateEffort('high', 'claude-haiku-5-5')).toContain('no effort')
  expect(validateEffort('turbo', 'claude-sonnet-5-5')).toContain('not valid')
  expect(validateEffort('high', 'claude-sonnet-5-5')).toBeUndefined()
  expect(savedEffort({ effortLevel: 'low', modelSettings: { m: { effortLevel: 'max' } } }, 'm')).toBe('max')
  expect(savedEffort({ effortLevel: 'low' }, 'm')).toBe('low')
})

test('settings: an invalid file is an error, never silently replaced', () => {
  expect(() => parseSettingsText('{ nope')).toThrow()
  expect(() => parseSettingsText('[]')).toThrow()
  expect(parseSettingsText('')).toEqual({})
  expect(parseSettingsText(serialize({ a: 1 }))).toEqual({ a: 1 })
})

test('tokens: parse plugin details, mcp list, server names', () => {
  const d = parseDetails(
    'Projected token cost\n  Always-on:   ~4,940 tok   added\n\nPer-component (rounded)\n  component  always-on  on-invoke\n  alpha   ~590   ~3.3k\n  beta   ~1.2k   ~25.2k\n\n  On-invoke cost',
  )
  expect(d.alwaysOn).toBe(4940)
  expect(d.components).toEqual({ alpha: 590, beta: 1200 })
  const l = parseMcpList(
    'Checking MCP server health…\n\nplugin:ct:knowledge: https://x.example/mcp (HTTP) - ✔ Connected\nclaude.ai Slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication\n',
  )
  expect(l.map(s => [s.name, s.ok])).toEqual([['plugin:ct:knowledge', true], ['claude.ai Slack', false]])
  expect(normalizeServer('claude.ai Slack')).toBe('claude_ai_Slack')
  expect(normalizeServer('plugin:ct:knowledge')).toBe('plugin_ct_knowledge')
  expect(serverOfTool('mcp__claude_ai_Slack__send')).toBe('claude_ai_Slack')
  expect(serverOfTool('Bash')).toBeUndefined()
})
