import type { IBufferRange, IDisposable, ILink, ILinkHandler, Terminal } from '@xterm/xterm'
import {
  ABS_PATH,
  REL_PATH,
  isPathText,
  type FoundPath,
  type PathCandidates
} from '../../../shared/link'

/**
 * 터미널 글자 가운데 링크가 되는 것 — URL 과 파일 경로(`file:` URL, `/` 로 시작하는 절대경로, `a/b.ext` 꼴의
 * 상대경로, 뒤에 `:줄:칸` 이 붙어도). OSC 8 로 찍힌 링크는 xterm 이 스스로 찾아 `linkHandler` 로 넘긴다.
 * 줄 끝에서 끊겨 다음 줄에 이어 찍힌 경로는 이어 붙인 경로가 실제로 있을 때 줄을 걸치는 링크 하나가 된다. 끊긴 URL 은
 * 잇지 않는다. 앱의 zsh 가 띄운 Claude Code 는 URL 을 OSC 8 로 감싸 찍기 때문이다(`resources/zsh/.zshenv` 의 `claude`).
 *
 * 이 모듈이 만든 링크의 밑줄과 포인터는 ⌘ 를 누른 동안만 보인다(Terminal.app·iTerm2 의 관행). OSC 8 링크의 장식은
 * xterm 이 채워 ⌘ 없이도 보인다. 클릭은 그대로 `activate` 에 넘기고, ⌘ 를 가리는 것은 부르는 쪽이다.
 */

const WEB_URL_RE = /https?:\/\/[^\s'"`)>\]},]+/g
// 문장 끝의 URL 은 구두점까지 잡히므로 뗀다.
const URL_TRAILING_RE = /[.,;:!?]+$/
const FILE_URL_RE = /file:\/\/\S+/g
const ABS_PATH_RE = new RegExp(/(?<![^\s:=(`'"])/.source + ABS_PATH, 'g')
const REL_PATH_RE = new RegExp(/(?<![/\w.-])/.source + REL_PATH, 'g')

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

/** 글자 하나가 놓인 글자 칸. `x` 는 0 기반 열, `y` 는 1 기반 행. */
export type CellPos = { x: number; y: number; width: number }

export type LineText = {
  text: string
  /**
   * `cells[i]` 는 `text[i]`(UTF-16 단위라 surrogate pair 의 두 반쪽은 같은 글자 칸)가 놓인 글자 칸이다. 정규식은 문자열
   * 인덱스를 주는데 xterm 의 링크 범위는 글자 칸 열이라, 폭이 2 인 글자(한글·이모지) 뒤의 링크는 인덱스를 그대로
   * 쓰면 왼쪽으로 밀린다.
   */
  cells: CellPos[]
}

/** 논리 줄의 글자와, 그 줄을 이루는 첫 행과 끝 행(1 기반). */
export type WrappedLine = LineText & { first: number; last: number }

/**
 * 1 기반 행 `y` 가 든 논리 줄 — 화면 폭에서 접혀 이어진 행들 — 을 글자와 글자 칸 매핑으로 읽는다. 좁은 pane 에 찍힌
 * 긴 URL 은 여러 행에 걸치므로 한 행만 보면 접힌 자리에서 잘린 주소가 열린다. 넓은 글자의 둘째 글자 칸(폭 0)은
 * xterm 의 `translateToString` 처럼 글자를 내지 않는다. 끝의 공백은 뗀다.
 */
export function readWrappedLine<C extends CellLike>(buffer: BufferLike<C>, y: number): WrappedLine {
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
  return { text: trimmed, cells, first, last }
}

/**
 * macOS 의 `PATH_MAX`(`<sys/syslimits.h>`). 이은 글자가 이보다 길면 그 너머의 줄은 잇지 않는다. 이보다 긴 경로는 stat 이
 * 실패해 링크가 되지 않기 때문이다.
 */
const PATH_MAX = 1024

export type JoinedLines = LineText & {
  /** 이어 붙인 자리. 다음 줄의 글자가 시작하는 `text` 의 인덱스다. */
  joints: number[]
  /** 물은 논리 줄. 그 글자는 `text[start, end)` 에 놓였다. */
  self: WrappedLine
  start: number
  end: number
}

const isOneToken = (text: string): boolean => !/\s/.test(text.trim())

/**
 * 1 기반 행 `y` 의 논리 줄을 앞뒤 논리 줄과 이어 붙여 읽는다. Claude Code 는 긴 경로를 줄 끝에서 끊고 커서를 옮겨 다음 줄에
 * 이어 찍으므로, xterm 에는 접힌 행이 아니라 별개의 줄로 남는다. 앞 줄의 글자 전체에 다음 줄의 앞 공백을 뗀 글자를 붙인다.
 * 토큰 하나뿐인 줄을 지나면 그 너머 줄도 붙이고, 빈 줄에서 멈춘다.
 */
export function readJoinedLines<C extends CellLike>(buffer: BufferLike<C>, y: number): JoinedLines {
  const self = readWrappedLine(buffer, y)
  const before: LineText[] = []
  const after: LineText[] = []
  if (self.text.trim()) {
    const walk = (row: number, step: -1 | 1, into: LineText[]): void => {
      let length = 0
      while (length <= PATH_MAX && row >= 1 && buffer.getLine(row - 1)) {
        const line = readWrappedLine(buffer, row)
        if (!line.text.trim()) return
        into.push(line)
        if (!isOneToken(line.text)) return
        length += line.text.trim().length
        row = step < 0 ? line.first - 1 : line.last + 1
      }
    }
    walk(self.first - 1, -1, before)
    walk(self.last + 1, 1, after)
  }
  let text = ''
  const cells: CellPos[] = []
  const joints: number[] = []
  let start = 0
  let end = 0
  const pieces = [...before.reverse(), self, ...after]
  pieces.forEach((piece, i) => {
    const skip = i === 0 ? 0 : piece.text.length - piece.text.trimStart().length
    if (i > 0) joints.push(text.length)
    if (piece === self) start = text.length
    text += piece.text.slice(skip)
    // spread 로 넘기면 글자 칸이 십만 개를 넘는 접힌 줄(minified 파일)에서 인자 수 한도에 걸린다.
    for (let c = skip; c < piece.cells.length; c++) cells.push(piece.cells[c])
    if (piece === self) end = text.length
  })
  return { text, cells, joints, self, start, end }
}

export type JoinedPath = {
  /** 후보들이 놓인 `JoinedLines.text` 의 인덱스. 후보의 인덱스는 여기서부터 센다. */
  offset: number
  candidates: PathCandidates
}

/**
 * 이어 붙인 자리를 걸치고 물은 줄에 닿는 경로 match 마다, match 를 이음 자리에서 끊어 본 후보들을 낸다. 정규식은 가장 길게
 * 잡아 다음 줄의 상관없는 글자까지 붙일 수 있으므로, 실제 경로는 match 를 이음 자리에서 끊은 것일 수 있다. 시작은 match
 * 시작과 물은 줄의 글자 시작 앞쪽의 이음 자리에서, 끝은 물은 줄의 글자 끝 뒤쪽의 이음 자리와 match 끝에서 고른다. 그래야
 * 모든 후보가 물은 줄에 닿는다. URL 은 잇지 않는다.
 */
export function joinedPaths(lines: JoinedLines): JoinedPath[] {
  const { text, joints, start, end } = lines
  if (joints.length === 0) return []
  return detectLinks(text).flatMap((link) => {
    const inside = joints.filter((j) => link.startIndex < j && j < link.endIndex)
    const touches = link.startIndex < end && link.endIndex > start
    if (inside.length === 0 || !touches || !isPathText(link.text)) return []
    const offset = link.startIndex
    const starts = [0, ...inside.filter((j) => j <= start).map((j) => j - offset)]
    const ends = [...inside.filter((j) => j >= end).map((j) => j - offset), link.text.length]
    return [{ offset, candidates: { text: link.text, starts, ends } }]
  })
}

/** `text[startIndex, endIndex)` 를 덮는 xterm 링크 범위(열은 1 기반, 양 끝 포함). 넓은 글자로 끝나면 그 둘째 글자 칸까지. */
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

/** main 의 `longestExistingPaths` — 후보마다 실제로 있는 가장 긴 것. */
export type LongestExisting = (paths: PathCandidates[]) => Promise<FoundPath[]>

type Pos = IBufferRange['start']
const compare = (a: Pos, b: Pos): number => a.y - b.y || a.x - b.x
const overlaps = (a: IBufferRange, b: IBufferRange): boolean =>
  compare(a.start, b.end) <= 0 && compare(b.start, a.end) <= 0

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
  activate: Activate,
  longestExisting: LongestExisting
): IDisposable {
  let hovered: ILink | undefined
  const stopMeta = meta.onChange((pressed) => {
    if (hovered) decorate(hovered, pressed)
  })
  const toLink = (range: IBufferRange, text: string): ILink => {
    const link: ILink = {
      range,
      text,
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
  }
  // xterm 은 다른 줄을 물으면 provider 답을 담을 Map(`_activeProviderReplies`)을 새로 만들지만, 늦게 온 앞 줄의
  // 답도 그 새 Map 에 넣는다(`Linkifier._askForLink`). 그래서 더 나중에 물은 것이 있으면 늦게 온 답은 내지 않는다.
  let asked = 0
  const registration = term.registerLinkProvider({
    provideLinks(y, callback) {
      const ask = ++asked
      const buffer = term.buffer.active
      if (!buffer.getLine(y - 1)) return callback(undefined)
      const lines = readJoinedLines(buffer, y)
      const { text, cells } = lines.self
      const links = detectLinks(text).map((d) =>
        toLink(linkRange(cells, d.startIndex, d.endIndex), d.text)
      )
      const paths = joinedPaths(lines)
      if (paths.length === 0) return callback(links.length > 0 ? links : undefined)
      // 이어 붙인 경로는 실제로 있을 때만 링크로 낸다. 줄 끝에 우연히 닿은 경로를 상관없는 다음 줄과 잇지 않기 위해서다.
      void longestExisting(paths.map((p) => p.candidates))
        .catch((): FoundPath[] => [])
        .then((found) => {
          if (ask !== asked) return
          const joined = paths.flatMap(({ offset }, i) => {
            const at = found[i]
            if (!at) return []
            const [s, e] = [offset + at[0], offset + at[1]]
            // 이음 자리를 걸치지 않은 후보는 물은 줄의 글자 그대로라 줄마다 찾은 링크와 같다.
            if (!lines.joints.some((j) => s < j && j < e)) return []
            return [toLink(linkRange(lines.cells, s, e), lines.text.slice(s, e))]
          })
          const rest = links.filter((l) => !joined.some((j) => overlaps(j.range, l.range)))
          const all = [...joined, ...rest]
          callback(all.length > 0 ? all : undefined)
        })
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
