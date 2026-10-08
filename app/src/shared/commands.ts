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
  | 'toggle-view-mode'

export type Command = {
  id: CommandId
  title: string
  menu: 'file' | 'view'
  palette?: false
}

export const commands: readonly Command[] = [
  { id: 'new-workspace', title: 'New Workspace', menu: 'file' },
  { id: 'split-right', title: 'Split Right', menu: 'file' },
  { id: 'split-down', title: 'Split Down', menu: 'file' },
  { id: 'close-pane', title: 'Close Pane', menu: 'file' },
  { id: 'command-palette', title: 'Command Palette…', menu: 'view', palette: false },
  { id: 'toggle-canvas', title: 'Toggle Canvas', menu: 'view' },
  { id: 'toggle-view-mode', title: 'Toggle View Mode', menu: 'view' },
  { id: 'focus-pane-left', title: 'Focus Pane Left', menu: 'view' },
  { id: 'focus-pane-right', title: 'Focus Pane Right', menu: 'view' },
  { id: 'focus-pane-up', title: 'Focus Pane Up', menu: 'view' },
  { id: 'focus-pane-down', title: 'Focus Pane Down', menu: 'view' }
]

export function filterCommands(query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return commands.filter(
    (c) => c.palette !== false && words.every((w) => c.title.toLowerCase().includes(w))
  )
}
