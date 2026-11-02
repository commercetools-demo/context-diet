export type DietPlugin = { id: string; name: string; tokens?: number; skills: string[]; servers: string[] }
export type DietServer = { name: string; key: string; status: string; connector: boolean; tools: number; tokens: number }
export type DietSkill = { name: string; plugin?: string; tokens: number }
export type DietAgent = { type: string; tokens: number; plugin?: string }
export type DietInventory = {
  at: number
  plugins: DietPlugin[]
  servers: DietServer[]
  skills: DietSkill[]
  agents: DietAgent[]
  errors: string[]
}
export type DietBlock = {
  servers: string[]
  plugins: string[]
  skills: string[]
  agents: string[]
  commands: string[]
}
export type DietInfo = { model: string; effort?: string; envEffort?: string }
export type DietOffered = { type: string; description: string; plugin?: string }

declare module 'claude-code' {
  interface PluginState {
    'context-diet': {
      /** Targets (kind:name) disabled for this session by the mod's hooks. */
      off: string[]
      /** What the hooks check: derived from `off` and the inventory. */
      block: DietBlock
      /** Pane selection: unchecked targets, not yet applied. */
      draft: string[]
      draftModel: string
      draftEffort: string
      inventory: DietInventory | null
      info: DietInfo | null
      offered: DietOffered[]
      isBandShown: boolean
      isScanning: boolean
      note: string
    }
  }
}
