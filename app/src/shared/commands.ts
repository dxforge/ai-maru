export type CommandId = 'new-workspace' | 'command-palette' | 'toggle-canvas'

export type Command = {
  id: CommandId
  title: string
  menu: 'file' | 'view'
  accelerator?: string
  palette?: false
}

export const commands: readonly Command[] = [
  { id: 'new-workspace', title: 'New Workspace', menu: 'file', accelerator: 'Command+N' },
  {
    id: 'command-palette',
    title: 'Command Palette…',
    menu: 'view',
    accelerator: 'Shift+Command+P',
    palette: false
  },
  { id: 'toggle-canvas', title: 'Toggle Canvas', menu: 'view' }
]

export function filterCommands(query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return commands.filter(
    (c) => c.palette !== false && words.every((w) => c.title.toLowerCase().includes(w))
  )
}

const MODIFIERS: [string, string[]][] = [
  ['⌃', ['Control', 'Ctrl']],
  ['⌥', ['Alt', 'Option']],
  ['⇧', ['Shift']],
  ['⌘', ['Command', 'Cmd', 'CommandOrControl', 'CmdOrCtrl']]
]

export function formatAccelerator(accelerator: string): string {
  const parts = accelerator.split('+')
  const key = parts.pop()!
  const mods = MODIFIERS.filter(([, names]) => names.some((n) => parts.includes(n)))
  return mods.map(([sign]) => sign).join('') + key
}
