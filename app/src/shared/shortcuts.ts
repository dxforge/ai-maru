/** 앱이 받는 키 조합은 명령·메뉴 role·터미널 입력 가운데 어디에 쓰든 이 표에 한 번씩 적는다 — 두 곳에 걸린 키는 한쪽에서만 불린다. */
import type { CommandId } from './commands'

export type MenuRole =
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAndMatchStyle'
  | 'delete'
  | 'selectAll'
  | 'startSpeaking'
  | 'stopSpeaking'
  | 'toggleDevTools'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'minimize'
  | 'zoom'
  | 'front'

export type MenuAction = MenuRole | 'toggle-full-screen'

/** `key` 는 Electron accelerator 의 키 이름이다(`N`, `Enter`, `Left`, `Plus`). */
export type Keys = { key: string; ctrl?: true; alt?: true; shift?: true; meta?: true }

export type Shortcut = Keys &
  (
    | { target: 'command'; action: CommandId }
    | { target: 'menu'; action: MenuAction }
    | { target: 'terminal'; input: string }
  )

export const shortcuts: readonly Shortcut[] = [
  { target: 'command', action: 'new-workspace', key: 'N', meta: true },
  { target: 'command', action: 'split-right', key: 'D', meta: true },
  { target: 'command', action: 'split-down', key: 'D', shift: true, meta: true },
  { target: 'command', action: 'close-pane', key: 'W', meta: true },
  { target: 'command', action: 'command-palette', key: 'P', shift: true, meta: true },
  { target: 'command', action: 'toggle-sidebar', key: 'B', meta: true },
  { target: 'command', action: 'toggle-canvas', key: 'B', alt: true, meta: true },
  { target: 'command', action: 'toggle-view-mode', key: 'Enter', ctrl: true, meta: true },
  { target: 'command', action: 'focus-pane-left', key: 'Left', alt: true, meta: true },
  { target: 'command', action: 'focus-pane-right', key: 'Right', alt: true, meta: true },
  { target: 'command', action: 'focus-pane-up', key: 'Up', alt: true, meta: true },
  { target: 'command', action: 'focus-pane-down', key: 'Down', alt: true, meta: true },

  // Electron 이 role 에 거는 기본 키와 같다.
  { target: 'menu', action: 'hide', key: 'H', meta: true },
  { target: 'menu', action: 'hideOthers', key: 'H', alt: true, meta: true },
  { target: 'menu', action: 'quit', key: 'Q', meta: true },
  { target: 'menu', action: 'undo', key: 'Z', meta: true },
  { target: 'menu', action: 'redo', key: 'Z', shift: true, meta: true },
  { target: 'menu', action: 'cut', key: 'X', meta: true },
  { target: 'menu', action: 'copy', key: 'C', meta: true },
  { target: 'menu', action: 'paste', key: 'V', meta: true },
  { target: 'menu', action: 'pasteAndMatchStyle', key: 'V', alt: true, shift: true, meta: true },
  { target: 'menu', action: 'selectAll', key: 'A', meta: true },
  { target: 'menu', action: 'toggleDevTools', key: 'I', alt: true, meta: true },
  { target: 'menu', action: 'resetZoom', key: '0', meta: true },
  { target: 'menu', action: 'zoomIn', key: 'Plus', meta: true },
  { target: 'menu', action: 'zoomOut', key: '-', meta: true },
  { target: 'menu', action: 'toggle-full-screen', key: 'F', ctrl: true, meta: true },
  { target: 'menu', action: 'minimize', key: 'M', meta: true },

  // xterm 은 ⌘⌫ 의 ⌘ 을 무시해 한 글자만 지운다. iTerm2·Terminal.app 처럼 ⌃U 를 보낸다.
  { target: 'terminal', input: '\x15', key: 'Backspace', meta: true },
  // xterm 은 ⌘← / ⌘→ 에 아무것도 보내지 않는다. 줄 처음·끝으로 가는 ⌃A / ⌃E 를 보낸다.
  { target: 'terminal', input: '\x01', key: 'Left', meta: true },
  { target: 'terminal', input: '\x05', key: 'Right', meta: true }
]

export function commandKeys(id: CommandId): Keys | undefined {
  return shortcuts.find((s) => s.target === 'command' && s.action === id)
}

export function menuKeys(action: MenuAction): Keys | undefined {
  return shortcuts.find((s) => s.target === 'menu' && s.action === action)
}

export function toAccelerator(k: Keys): string {
  const mods = [k.ctrl && 'Control', k.alt && 'Alt', k.shift && 'Shift', k.meta && 'Command']
  return [...mods.filter(Boolean), k.key].join('+')
}

const LABELS: Record<string, string> = {
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Enter: '↩',
  Backspace: '⌫',
  Plus: '+'
}

export function formatKeys(k: Keys): string {
  const mods = `${k.ctrl ? '⌃' : ''}${k.alt ? '⌥' : ''}${k.shift ? '⇧' : ''}${k.meta ? '⌘' : ''}`
  return mods + (LABELS[k.key] ?? k.key)
}

const CODES: Record<string, string> = {
  Enter: 'Enter',
  Backspace: 'Backspace',
  Plus: 'Equal',
  '-': 'Minus',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown'
}

// ⌥ 를 누르면 KeyboardEvent.key 가 다른 글자로 바뀌므로(⌥⌘B 는 `∫`) 자판 위치인 code 로 맞춘다.
export function keyCode(key: string): string | undefined {
  if (/^[A-Z]$/.test(key)) return `Key${key}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  return CODES[key]
}

/** KeyboardEvent 대신 쓴다 — shared 는 DOM 타입이 없는 main 쪽 tsconfig 로도 빌드된다. */
export type KeyEventLike = {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export function matchesKeys(e: KeyEventLike, k: Keys): boolean {
  return (
    e.code === keyCode(k.key) &&
    e.ctrlKey === !!k.ctrl &&
    e.altKey === !!k.alt &&
    e.shiftKey === !!k.shift &&
    e.metaKey === !!k.meta
  )
}

export function isAppKey(e: KeyEventLike): boolean {
  return shortcuts.some((s) => s.target !== 'terminal' && matchesKeys(e, s))
}

export function terminalInput(e: KeyEventLike): string | undefined {
  for (const s of shortcuts) if (s.target === 'terminal' && matchesKeys(e, s)) return s.input
  return undefined
}
