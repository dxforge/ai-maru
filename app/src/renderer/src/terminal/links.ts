import type { IBufferRange, IDisposable, ILink, ILinkHandler, Terminal } from '@xterm/xterm'

/**
 * 터미널 글자 가운데 링크가 되는 것 — URL 과 파일 경로(`file:` URL, `/` 로 시작하는 절대경로, `a/b.ext` 꼴의
 * 상대경로, 뒤에 `:줄:칸` 이 붙어도). OSC 8 로 찍힌 링크는 xterm 이 스스로 찾아 `linkHandler` 로 넘긴다.
 *
 * 이 모듈이 만든 링크의 밑줄과 포인터는 ⌘ 를 누른 동안만 보인다(Terminal.app·iTerm2 의 관행). OSC 8 링크의 장식은
 * xterm 이 채워 ⌘ 없이도 보인다. 클릭은 그대로 `activate` 에 넘기고, ⌘ 를 가리는 것은 부르는 쪽이다.
 */

const WEB_URL_RE = /https?:\/\/[^\s'"`)>\]},]+/g
// 문장 끝의 URL 은 구두점까지 잡히므로 뗀다.
const URL_TRAILING_RE = /[.,;:!?]+$/
const FILE_URL_RE = /file:\/\/\S+/g
const ABS_PATH_RE =
  /(?<![^\s:=(`'"])\/+(?:[^\s/:,;'"`)>\]{}]+\/+)*[^\s/:,;'"`)>\]{}]+\.[a-zA-Z0-9]+(?::\d+(?::\d+)?)?/g
const REL_PATH_RE =
  /(?<![/\w.-])(?:[a-zA-Z0-9_@.-]+\/)+[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+(?::\d+(?::\d+)?)?/g

export type DetectedLink = {
  text: string
  /** 문자열 인덱스. 시작은 포함, 끝은 제외. */
  startIndex: number
  endIndex: number
}

/** URL 을 먼저 찾는다. `https://a.io/x` 안의 `//a.io/x` 처럼 먼저 찾은 링크와 겹치는 경로는 버린다. */
export function detectLinks(lineText: string): DetectedLink[] {
  const links: DetectedLink[] = []
  for (const re of [WEB_URL_RE, FILE_URL_RE, ABS_PATH_RE, REL_PATH_RE]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(lineText)) !== null) {
      const text = re === WEB_URL_RE ? match[0].replace(URL_TRAILING_RE, '') : match[0]
      const startIndex = match.index
      const endIndex = startIndex + text.length
      if (links.some((l) => startIndex < l.endIndex && endIndex > l.startIndex)) continue
      links.push({ text, startIndex, endIndex })
    }
  }
  return links.sort((a, b) => a.startIndex - b.startIndex)
}

/** xterm 의 `IBufferCell` 가운데 여기서 읽는 것. */
export type CellLike = { getChars(): string; getWidth(): number }

/** xterm 의 `IBufferLine` 가운데 여기서 읽는 것. */
export type LineLike<C extends CellLike = CellLike> = {
  readonly length: number
  readonly isWrapped: boolean
  getCell(x: number, cell?: C): C | undefined
}

/** xterm 의 `IBuffer` 가운데 여기서 읽는 것. `getLine` 의 인덱스는 0 기반이다. */
export type BufferLike<C extends CellLike = CellLike> = {
  getLine(y: number): LineLike<C> | undefined
}

/** 글자 하나가 놓인 셀. `x` 는 0 기반 열, `y` 는 1 기반 행. */
export type CellPos = { x: number; y: number; width: number }

export type LineText = {
  text: string
  /**
   * `cells[i]` 는 `text[i]`(UTF-16 단위라 surrogate pair 의 두 반쪽은 같은 셀)가 놓인 셀이다. 정규식은 문자열
   * 인덱스를 주는데 xterm 의 링크 범위는 셀 열이라, 폭이 2 인 글자(한글·이모지) 뒤의 링크는 인덱스를 그대로
   * 쓰면 왼쪽으로 밀린다.
   */
  cells: CellPos[]
}

/**
 * 1 기반 행 `y` 가 든 논리 줄 — 화면 폭에서 접혀 이어진 행들 — 을 글자와 셀 매핑으로 읽는다. 좁은 pane 에 찍힌
 * 긴 URL 은 여러 행에 걸치므로 한 행만 보면 접힌 자리에서 잘린 주소가 열린다. 넓은 글자의 둘째 셀(폭 0)은
 * xterm 의 `translateToString` 처럼 글자를 내지 않는다. 끝의 공백은 뗀다.
 */
export function readWrappedLine<C extends CellLike>(buffer: BufferLike<C>, y: number): LineText {
  let first = y
  while (first > 1 && buffer.getLine(first - 1)?.isWrapped) first--
  let last = y
  while (buffer.getLine(last)?.isWrapped) last++
  let text = ''
  const cells: CellPos[] = []
  let reuse: C | undefined
  for (let row = first; row <= last; row++) {
    const line = buffer.getLine(row - 1)
    if (!line) break
    let x = 0
    while (x < line.length) {
      const cell = line.getCell(x, reuse)
      reuse = cell
      const chars = cell?.getChars() || ' '
      const width = cell?.getWidth() || 1
      text += chars
      for (let i = 0; i < chars.length; i++) cells.push({ x, y: row, width })
      x += width
    }
  }
  const trimmed = text.trimEnd()
  cells.length = trimmed.length
  return { text: trimmed, cells }
}

/** `text[startIndex, endIndex)` 를 덮는 xterm 링크 범위(열은 1 기반, 양 끝 포함). 넓은 글자로 끝나면 그 둘째 셀까지. */
export function linkRange(cells: CellPos[], startIndex: number, endIndex: number): IBufferRange {
  const start = cells[startIndex]
  const end = cells[endIndex - 1]
  return { start: { x: start.x + 1, y: start.y }, end: { x: end.x + end.width, y: end.y } }
}

export type MetaKey = {
  readonly pressed: boolean
  onChange(cb: (pressed: boolean) => void): () => void
}

/** 창 전체에서 ⌘ 가 눌린 상태. ⌘Tab 으로 창을 떠나면 keyup 이 오지 않으므로 blur 에서 푼다. */
export function trackMetaKey(target: Window): MetaKey {
  let pressed = false
  const listeners = new Set<(pressed: boolean) => void>()
  const set = (now: boolean): void => {
    if (now === pressed) return
    pressed = now
    for (const cb of listeners) cb(now)
  }
  target.document.addEventListener('keydown', (e) => e.key === 'Meta' && set(true))
  target.document.addEventListener('keyup', (e) => e.key === 'Meta' && set(false))
  target.addEventListener('blur', () => set(false))
  return {
    get pressed() {
      return pressed
    },
    onChange(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    }
  }
}

export type Activate = (event: MouseEvent, text: string) => void

function decorate(link: ILink, show: boolean): void {
  if (!link.decorations) return
  link.decorations.pointerCursor = show
  link.decorations.underline = show
}

/**
 * 글자로 찍힌 URL·경로를 링크로 만들어 `term` 에 단다. OSC 8 링크는 xterm 의 provider 가 따로 만든다.
 *
 * hover 중인 링크 객체는 들고 있되 decorations 객체는 들지 않는다. xterm 은 `hover()` 를 부른 직후 `link.decorations` 를
 * 밑줄을 그리는 setter 가 달린 자기 객체로 바꾸므로(`Linkifier._handleNewLink`), 그 전에 잡은 객체에 써도
 * 화면이 바뀌지 않는다. hover 중인 링크는 한 번에 하나다. xterm 이 다음 `hover` 전에 `leave` 를 부르기 때문이다.
 */
export function registerLinkProvider(
  term: Terminal,
  meta: MetaKey,
  activate: Activate
): IDisposable {
  let hovered: ILink | undefined
  const stopMeta = meta.onChange((pressed) => {
    if (hovered) decorate(hovered, pressed)
  })
  const registration = term.registerLinkProvider({
    provideLinks(y, callback) {
      if (!term.buffer.active.getLine(y - 1)) return callback(undefined)
      const { text, cells } = readWrappedLine(term.buffer.active, y)
      const detected = detectLinks(text)
      if (detected.length === 0) return callback(undefined)
      callback(
        detected.map((d) => {
          const link: ILink = {
            range: linkRange(cells, d.startIndex, d.endIndex),
            text: d.text,
            decorations: { pointerCursor: meta.pressed, underline: meta.pressed },
            hover() {
              hovered = link
              // xterm 은 이 뒤에 자기 decorations 객체를 끼우며 줄을 읽을 때의 값으로 채운다. 그 뒤에 다시
              // 써야 그 사이에 누른 ⌘ 가 보인다.
              queueMicrotask(() => {
                if (hovered === link) decorate(link, meta.pressed)
              })
            },
            leave() {
              hovered = undefined
              decorate(link, false)
            },
            activate
          }
          return link
        })
      )
    }
  })
  return {
    dispose() {
      stopMeta()
      registration.dispose()
    }
  }
}

export function createLinkHandler(
  activate: Activate,
  hover: (url: string | null) => void
): ILinkHandler {
  return {
    allowNonHttpProtocols: true,
    activate,
    hover(_event, text) {
      hover(text)
    },
    leave() {
      hover(null)
    }
  }
}
