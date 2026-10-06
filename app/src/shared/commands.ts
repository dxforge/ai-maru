export type CommandId =
  | 'new-workspace'
  | 'split-right'
  | 'split-down'
  | 'close-pane'
  | 'focus-pane-left'
  | 'focus-pane-right'
  | 'focus-pane-up'
  | 'focus-pane-down'
  | 'command-palette'
  | 'toggle-canvas'

export type Command = {
  id: CommandId
  title: string
  menu: 'file' | 'view'
  accelerator?: string
  palette?: false
}

export const commands: readonly Command[] = [
  { id: 'new-workspace', title: 'New Workspace', menu: 'file', accelerator: 'Command+N' },
  { id: 'split-right', title: 'Split Right', menu: 'file', accelerator: 'Command+D' },
  { id: 'split-down', title: 'Split Down', menu: 'file', accelerator: 'Shift+Command+D' },
  { id: 'close-pane', title: 'Close Pane', menu: 'file', accelerator: 'Command+W' },
  {
    id: 'command-palette',
    title: 'Command Palette…',
    menu: 'view',
    accelerator: 'Shift+Command+P',
    palette: false
  },
  { id: 'toggle-canvas', title: 'Toggle Canvas', menu: 'view' },
  {
    id: 'focus-pane-left',
    title: 'Focus Pane Left',
    menu: 'view',
    accelerator: 'Alt+Command+Left'
  },
  {
    id: 'focus-pane-right',
    title: 'Focus Pane Right',
    menu: 'view',
    accelerator: 'Alt+Command+Right'
  },
  { id: 'focus-pane-up', title: 'Focus Pane Up', menu: 'view', accelerator: 'Alt+Command+Up' },
  { id: 'focus-pane-down', title: 'Focus Pane Down', menu: 'view', accelerator: 'Alt+Command+Down' }
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

const KEYS: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓' }

export function formatAccelerator(accelerator: string): string {
  const parts = accelerator.split('+')
  const key = parts.pop()!
  const mods = MODIFIERS.filter(([, names]) => names.some((n) => parts.includes(n)))
  return mods.map(([sign]) => sign).join('') + (KEYS[key] ?? key)
}
