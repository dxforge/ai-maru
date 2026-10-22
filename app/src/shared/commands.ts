export type CommandId =
  | 'new-workspace'
  | 'next-workspace'
  | 'previous-workspace'
  | 'split-right'
  | 'split-down'
  | 'close-pane'
  | 'focus-pane-left'
  | 'focus-pane-right'
  | 'focus-pane-up'
  | 'focus-pane-down'
  | 'command-palette'
  | 'toggle-sidebar'
  | 'toggle-canvas'
  | 'toggle-view-mode'
  | 'increase-font-size'
  | 'decrease-font-size'
  | 'reset-font-size'
  | 'restart'

export type Command = {
  id: CommandId
  title: string
  menu: 'app' | 'file' | 'view'
  palette?: false
}

export const commands: readonly Command[] = [
  { id: 'new-workspace', title: 'New Workspace', menu: 'file' },
  { id: 'split-right', title: 'Split Right', menu: 'file' },
  { id: 'split-down', title: 'Split Down', menu: 'file' },
  { id: 'close-pane', title: 'Close Pane', menu: 'file' },
  { id: 'command-palette', title: 'Command Palette…', menu: 'view', palette: false },
  { id: 'next-workspace', title: 'Next Workspace', menu: 'view' },
  { id: 'previous-workspace', title: 'Previous Workspace', menu: 'view' },
  { id: 'toggle-sidebar', title: 'Toggle Sidebar', menu: 'view' },
  { id: 'toggle-canvas', title: 'Toggle Canvas', menu: 'view' },
  { id: 'toggle-view-mode', title: 'Toggle View Mode', menu: 'view' },
  { id: 'focus-pane-left', title: 'Focus Pane Left', menu: 'view' },
  { id: 'focus-pane-right', title: 'Focus Pane Right', menu: 'view' },
  { id: 'focus-pane-up', title: 'Focus Pane Up', menu: 'view' },
  { id: 'focus-pane-down', title: 'Focus Pane Down', menu: 'view' },
  { id: 'increase-font-size', title: 'Increase Font Size', menu: 'view' },
  { id: 'decrease-font-size', title: 'Decrease Font Size', menu: 'view' },
  { id: 'reset-font-size', title: 'Reset Font Size', menu: 'view' },
  { id: 'restart', title: 'Restart', menu: 'app' }
]

export function available(c: Command, { canRestart }: { canRestart: boolean }): boolean {
  return c.id !== 'restart' || canRestart
}

export function filterCommands(query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return commands.filter(
    (c) => c.palette !== false && words.every((w) => c.title.toLowerCase().includes(w))
  )
}
