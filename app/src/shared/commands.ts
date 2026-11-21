export type CommandId =
  | 'new-workspace'
  | 'new-cell'
  | 'launcher'
  | 'next-cell'
  | 'previous-cell'
  | 'next-pane'
  | 'previous-pane'
  | 'split-right'
  | 'split-down'
  | 'launch-cell'
  | 'launch-workspace'
  | 'launch-split-right'
  | 'launch-split-down'
  | 'close-pane'
  | 'background-pane'
  | 'close-workspace'
  | 'rename-workspace'
  | 'toggle-keep-workspace'
  | 'toggle-favorite-cell'
  | 'focus-pane-left'
  | 'focus-pane-right'
  | 'focus-pane-up'
  | 'focus-pane-down'
  | 'resize-pane-left'
  | 'resize-pane-right'
  | 'resize-pane-up'
  | 'resize-pane-down'
  | 'equalize-panes'
  | 'command-palette'
  | 'go-to-pane'
  | 'toggle-sidebar'
  | 'toggle-canvas'
  | 'toggle-view-mode'
  | 'increase-font-size'
  | 'decrease-font-size'
  | 'reset-font-size'
  | 'widen-cell'
  | 'narrow-cell'
  | 'reset-cell-width'
  | 'clear-scrollback'
  | 'restart'

export type CommandGroup =
  'Workspace' | 'Cell' | 'Pane' | 'Pane Size' | 'Launch' | 'Go to' | 'View' | 'Terminal' | 'AI Maru'

export type Command = {
  id: CommandId
  title: string
  group: CommandGroup
  menu: 'app' | 'file' | 'view'
  palette?: false
}

/**
 * 배열 순서가 팔레트와 메뉴의 순서다. 팔레트와 메뉴는 묶음이 바뀌는 곳마다 제목·구분선을 두므로 같은 묶음의 명령은 붙여 둔다.
 */
export const commands: readonly Command[] = [
  { id: 'new-workspace', title: 'New Workspace', group: 'Workspace', menu: 'file' },
  { id: 'rename-workspace', title: 'Rename Workspace…', group: 'Workspace', menu: 'file' },
  { id: 'toggle-keep-workspace', title: 'Keep Workspace', group: 'Workspace', menu: 'file' },
  { id: 'toggle-favorite-cell', title: 'Toggle Favorite', group: 'Workspace', menu: 'file' },
  { id: 'close-workspace', title: 'Close Workspace', group: 'Workspace', menu: 'file' },
  { id: 'new-cell', title: 'New Cell', group: 'Cell', menu: 'file' },
  { id: 'next-cell', title: 'Next Cell', group: 'Cell', menu: 'view' },
  { id: 'previous-cell', title: 'Previous Cell', group: 'Cell', menu: 'view' },
  { id: 'widen-cell', title: 'Widen Cell', group: 'Cell', menu: 'view' },
  { id: 'narrow-cell', title: 'Narrow Cell', group: 'Cell', menu: 'view' },
  { id: 'reset-cell-width', title: 'Reset Cell Width', group: 'Cell', menu: 'view' },
  { id: 'split-right', title: 'Split Right', group: 'Pane', menu: 'file' },
  { id: 'split-down', title: 'Split Down', group: 'Pane', menu: 'file' },
  { id: 'next-pane', title: 'Next Pane', group: 'Pane', menu: 'view' },
  { id: 'previous-pane', title: 'Previous Pane', group: 'Pane', menu: 'view' },
  { id: 'focus-pane-left', title: 'Focus Pane Left', group: 'Pane', menu: 'view' },
  { id: 'focus-pane-right', title: 'Focus Pane Right', group: 'Pane', menu: 'view' },
  { id: 'focus-pane-up', title: 'Focus Pane Up', group: 'Pane', menu: 'view' },
  { id: 'focus-pane-down', title: 'Focus Pane Down', group: 'Pane', menu: 'view' },
  { id: 'close-pane', title: 'Close Pane', group: 'Pane', menu: 'file' },
  { id: 'background-pane', title: 'Send Pane to Background', group: 'Pane', menu: 'file' },
  { id: 'resize-pane-left', title: 'Resize Pane Left', group: 'Pane Size', menu: 'view' },
  { id: 'resize-pane-right', title: 'Resize Pane Right', group: 'Pane Size', menu: 'view' },
  { id: 'resize-pane-up', title: 'Resize Pane Up', group: 'Pane Size', menu: 'view' },
  { id: 'resize-pane-down', title: 'Resize Pane Down', group: 'Pane Size', menu: 'view' },
  { id: 'equalize-panes', title: 'Equalize Panes', group: 'Pane Size', menu: 'view' },
  { id: 'launcher', title: 'Open Launcher', group: 'Launch', menu: 'file' },
  { id: 'launch-workspace', title: 'Launch in New Workspace…', group: 'Launch', menu: 'file' },
  { id: 'launch-cell', title: 'Launch in New Cell…', group: 'Launch', menu: 'file' },
  { id: 'launch-split-right', title: 'Launch Split Right…', group: 'Launch', menu: 'file' },
  { id: 'launch-split-down', title: 'Launch Split Down…', group: 'Launch', menu: 'file' },
  {
    id: 'command-palette',
    title: 'Command Palette…',
    group: 'Go to',
    menu: 'view',
    palette: false
  },
  { id: 'go-to-pane', title: 'Go to Pane or Favorite…', group: 'Go to', menu: 'view' },
  { id: 'toggle-sidebar', title: 'Toggle Sidebar', group: 'View', menu: 'view' },
  { id: 'toggle-canvas', title: 'Toggle Canvas', group: 'View', menu: 'view' },
  { id: 'toggle-view-mode', title: 'Toggle View Mode', group: 'View', menu: 'view' },
  { id: 'increase-font-size', title: 'Increase Font Size', group: 'Terminal', menu: 'view' },
  { id: 'decrease-font-size', title: 'Decrease Font Size', group: 'Terminal', menu: 'view' },
  { id: 'reset-font-size', title: 'Reset Font Size', group: 'Terminal', menu: 'view' },
  { id: 'clear-scrollback', title: 'Clear Scrollback', group: 'Terminal', menu: 'view' },
  { id: 'restart', title: 'Restart', group: 'AI Maru', menu: 'app' }
]

export function available(c: Command, { canRestart }: { canRestart: boolean }): boolean {
  return c.id !== 'restart' || canRestart
}

export function matchesWords(text: string, query: string): boolean {
  const t = foldCase(text)
  return foldCase(query)
    .split(/\s+/)
    .every((w) => t.includes(w))
}

// 런처가 거르는 경로에는 Finder 가 만든 한글 이름(NFD)이 섞이므로, 입력기로 친 이름(NFC)과 맞추려고 NFC 로 정규화한다.
export function foldCase(s: string): string {
  return s.normalize('NFC').toLowerCase()
}

export function filterCommands(query: string): Command[] {
  return commands.filter((c) => c.palette !== false && matchesWords(c.title, query))
}

export type PaletteItem<C extends Command = Command> =
  | { kind: 'head'; key: string; title: CommandGroup }
  | { kind: 'command'; key: string; i: number; command: C }

function groupRuns<C extends Command>(list: readonly C[]): C[][] {
  const runs: C[][] = []
  list.forEach((c, i) => {
    if (c.group !== list[i - 1]?.group) runs.push([])
    runs[runs.length - 1].push(c)
  })
  return runs
}

export function paletteItems<C extends Command>(list: readonly C[]): PaletteItem<C>[] {
  let i = 0
  return groupRuns(list).flatMap((run): PaletteItem<C>[] => [
    { kind: 'head', key: `head:${run[0].group}`, title: run[0].group },
    ...run.map((command) => ({ kind: 'command' as const, key: command.id, i: i++, command }))
  ])
}

export function menuSections(
  menu: Command['menu'],
  can: Parameters<typeof available>[1]
): Command[][] {
  return groupRuns(commands.filter((c) => c.menu === menu && available(c, can)))
}
