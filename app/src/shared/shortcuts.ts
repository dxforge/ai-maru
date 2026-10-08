/**
 * 앱이 받는 키 조합은 모두 이 표에 한 번씩 적는다.
 *
 * renderer 가 먼저 키를 받고, preventDefault 한 키는 메뉴로 가지 않는다. 그래서 터미널은 명령의
 * 키를 셸로 보내지 않고 흘려보낸다(`isCommandKey`). 메뉴 role 의 키도 여기 적어 메뉴가 그대로 건다
 * — 명령과 겹치면 그 명령이 키로는 불리지 않아, 겹치지 않는지를 한 표에서 테스트한다.
 */
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
  | 'reload'
  | 'forceReload'
  | 'toggleDevTools'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'togglefullscreen'
  | 'minimize'
  | 'zoom'
  | 'front'

/** `key` 는 Electron accelerator 의 키 이름이다(`N`, `Enter`, `Left`, `Plus`). */
export type Keys = { key: string; ctrl?: true; alt?: true; shift?: true; meta?: true }

export type Shortcut = Keys &
  ({ target: 'command'; action: CommandId } | { target: 'menu'; action: MenuRole })

export const shortcuts: readonly Shortcut[] = [
  { target: 'command', action: 'new-workspace', key: 'N', meta: true },
  { target: 'command', action: 'split-right', key: 'D', meta: true },
  { target: 'command', action: 'split-down', key: 'D', shift: true, meta: true },
  { target: 'command', action: 'close-pane', key: 'W', meta: true },
  { target: 'command', action: 'command-palette', key: 'P', shift: true, meta: true },
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
  { target: 'menu', action: 'reload', key: 'R', meta: true },
  { target: 'menu', action: 'forceReload', key: 'R', shift: true, meta: true },
  { target: 'menu', action: 'toggleDevTools', key: 'I', alt: true, meta: true },
  { target: 'menu', action: 'resetZoom', key: '0', meta: true },
  { target: 'menu', action: 'zoomIn', key: 'Plus', meta: true },
  { target: 'menu', action: 'zoomOut', key: '-', meta: true },
  { target: 'menu', action: 'togglefullscreen', key: 'F', ctrl: true, meta: true },
  { target: 'menu', action: 'minimize', key: 'M', meta: true }
]

export function commandKeys(id: CommandId): Keys | undefined {
  return shortcuts.find((s) => s.target === 'command' && s.action === id)
}

export function roleKeys(role: MenuRole): Keys | undefined {
  return shortcuts.find((s) => s.target === 'menu' && s.action === role)
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
  Plus: '+'
}

/** macOS 메뉴처럼 ⌃⌥⇧⌘ 순서로 적는다. */
export function formatKeys(k: Keys): string {
  const mods = `${k.ctrl ? '⌃' : ''}${k.alt ? '⌥' : ''}${k.shift ? '⇧' : ''}${k.meta ? '⌘' : ''}`
  return mods + (LABELS[k.key] ?? k.key)
}

const CODES: Record<string, string> = {
  Enter: 'Enter',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown'
}

/**
 * KeyboardEvent.key 는 ⌥ 를 누르면 다른 글자가 되어(⌥⌘B 는 `∫`) 자판 위치인 code 로 맞춘다.
 */
export function keyCode(key: string): string | undefined {
  if (/^[A-Z]$/.test(key)) return `Key${key}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  return CODES[key]
}

/** KeyboardEvent 의 이 필드들 — main 쪽 tsconfig 엔 DOM 타입이 없다. */
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

export function isCommandKey(e: KeyEventLike): boolean {
  return shortcuts.some((s) => s.target === 'command' && matchesKeys(e, s))
}
