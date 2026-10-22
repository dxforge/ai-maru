import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import {
  createLinkHandler,
  detectLinks,
  linkRange,
  readWrappedLine,
  registerLinkProvider,
  type Activate,
  type BufferLike,
  type CellLike,
  type LineLike,
  type MetaKey
} from './links'

const texts = (line: string) => detectLinks(line).map((l) => l.text)

describe('detectLinks', () => {
  it('URL 은 닫는 괄호·따옴표·쉼표 앞에서 끝나고, 문장 끝의 구두점은 뗀다', () => {
    expect(
      texts('see (https://a.io/x?q=1) and "http://b.io", https://c.io/y. or https://d.io/z?!')
    ).toEqual(['https://a.io/x?q=1', 'http://b.io', 'https://c.io/y', 'https://d.io/z'])
  })

  it('file: URL 과 확장자가 있는 절대경로·상대경로를 찾고 :줄:칸 을 붙여 둔다', () => {
    expect(texts('file:///tmp/a.md /src/main.ts:12:3 src/app/x.vue:7 README')).toEqual([
      'file:///tmp/a.md',
      '/src/main.ts:12:3',
      'src/app/x.vue:7'
    ])
  })

  it('백틱·따옴표로 감싼 경로도 절대·상대 가리지 않고 찾는다', () => {
    expect(texts('see `/a/b.md`, "/c/d.ts", \'./e.vue\' and `f/g.rs`')).toEqual([
      '/a/b.md',
      '/c/d.ts',
      './e.vue',
      'f/g.rs'
    ])
  })

  it('확장자나 / 가 없는 글자와 URL 의 경로 부분은 경로로 보지 않는다', () => {
    expect(texts('cd /tmp ; a/b ; v1.2.3 ; https://h.io/p/q.md')).toEqual(['https://h.io/p/q.md'])
  })

  it('확장자 없는 경로 조각이 길게 이어진 줄도 바로 끝낸다', () => {
    // 경로 조각을 나누는 방법이 여럿이면, 끝에 확장자가 없을 때 정규식의 백트래킹이 조각 수에 지수적으로 늘어난다.
    const start = performance.now()
    expect(texts(` ${'/ab'.repeat(30)} `)).toEqual([])
    expect(performance.now() - start).toBeLessThan(100)
  })

  it('/ 가 겹친 절대경로도 통째로 찾는다', () => {
    expect(texts('x /a//b.txt //c/d.md')).toEqual(['/a//b.txt', '//c/d.md'])
  })

  it('위치를 문자열 인덱스로 주고 줄의 순서대로 돌려준다', () => {
    expect(detectLinks('x a/b.md y https://q.io')).toEqual([
      { text: 'a/b.md', startIndex: 2, endIndex: 8 },
      { text: 'https://q.io', startIndex: 11, endIndex: 23 }
    ])
  })
})

function line(chars: string[], isWrapped = false): LineLike<CellLike> {
  const cells = chars.map((c) => ({
    getChars: () => c,
    getWidth: () => (c === '' ? 0 : [...c].some((ch) => ch.codePointAt(0)! > 0x2e80) ? 2 : 1)
  }))
  return { length: cells.length, isWrapped, getCell: (x) => cells[x] }
}

const buffer = (lines: LineLike<CellLike>[]): BufferLike => ({ getLine: (y) => lines[y] })

describe('readWrappedLine·linkRange', () => {
  it('넓은 글자 뒤의 링크는 글자 인덱스보다 뒤 열에 놓인다', () => {
    // "한 a/b.md" — 한(2셀) 공백 a/b.md
    const l = line(['한', '', ' ', 'a', '/', 'b', '.', 'm', 'd', ' ', ' '])
    const { text, cells } = readWrappedLine(buffer([l]), 1)
    expect(text).toBe('한 a/b.md')
    const [link] = detectLinks(text)
    expect(linkRange(cells, link.startIndex, link.endIndex)).toEqual({
      start: { x: 4, y: 1 },
      end: { x: 9, y: 1 }
    })
  })

  it('surrogate pair 는 두 반쪽이 같은 셀이고, 넓은 글자로 끝나는 링크는 둘째 셀까지다', () => {
    const l = line(['😀', '', 'x', '한', ''])
    const { text, cells } = readWrappedLine(buffer([l]), 1)
    expect(text).toBe('😀x한')
    expect(cells.map((c) => c.x)).toEqual([0, 0, 2, 3])
    expect(linkRange(cells, 2, 4)).toEqual({ start: { x: 3, y: 1 }, end: { x: 5, y: 1 } })
  })

  it('빈 셀은 공백이고 끝의 공백은 뗀다', () => {
    const l: LineLike<CellLike> = {
      length: 3,
      isWrapped: false,
      getCell: (x) => (x === 0 ? undefined : line(['a']).getCell(0))
    }
    const { text, cells } = readWrappedLine(buffer([l]), 1)
    expect(text).toBe(' aa')
    expect(cells.map((c) => c.x)).toEqual([0, 1, 2])
  })

  it('접혀 이어진 행들을 한 줄로 읽고, 가운데 어느 행에서 물어도 같다', () => {
    const lines = [
      line([...'before']),
      line([...'https://e.io/']),
      line([...'long/path.md '], true),
      line([...'after'])
    ]
    for (const y of [2, 3]) {
      const { text, cells } = readWrappedLine(buffer(lines), y)
      expect(text).toBe('https://e.io/long/path.md')
      const [link] = detectLinks(text)
      expect(link.text).toBe('https://e.io/long/path.md')
      expect(linkRange(cells, link.startIndex, link.endIndex)).toEqual({
        start: { x: 1, y: 2 },
        end: { x: 12, y: 3 }
      })
    }
    expect(readWrappedLine(buffer(lines), 1).text).toBe('before')
    expect(readWrappedLine(buffer(lines), 4).text).toBe('after')
  })
})

function fakeMeta(pressed = false): MetaKey & { press(now: boolean): void } {
  const listeners = new Set<(p: boolean) => void>()
  return {
    get pressed() {
      return pressed
    },
    onChange(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    press(now) {
      pressed = now
      for (const cb of listeners) cb(now)
    }
  }
}

function fakeTerm(rows: (string | LineLike<CellLike>)[]) {
  const lines = rows.map((r) => (typeof r === 'string' ? line([...r]) : r))
  const t = {
    provider: undefined as ILinkProvider | undefined,
    unregistered: false,
    buffer: { active: buffer(lines) },
    registerLinkProvider(p: ILinkProvider) {
      t.provider = p
      return { dispose: () => void (t.unregistered = true) }
    }
  }
  return t
}

function provided(term: ReturnType<typeof fakeTerm>, y: number): ILink[] | undefined {
  let out: ILink[] | undefined
  term.provider!.provideLinks(y, (links) => (out = links))
  return out
}

const register = (
  term: ReturnType<typeof fakeTerm>,
  meta: MetaKey,
  activate: Activate = () => {}
) => registerLinkProvider(term as unknown as Terminal, meta, activate)

describe('registerLinkProvider', () => {
  it('줄의 링크마다 1 기반 셀 범위를 주고, 링크가 없는 줄과 버퍼 밖의 줄은 undefined 다', () => {
    const term = fakeTerm(['go /a/b.md now', 'plain'])
    register(term, fakeMeta())
    const links = provided(term, 1)!
    expect(links.map((l) => [l.text, l.range])).toEqual([
      ['/a/b.md', { start: { x: 4, y: 1 }, end: { x: 10, y: 1 } }]
    ])
    expect(provided(term, 2)).toBeUndefined()
    expect(provided(term, 3)).toBeUndefined()
  })

  it('접힌 URL 은 어느 행에서 물어도 행을 걸치는 범위 하나로 준다', () => {
    const term = fakeTerm([line([...'https://e.io/']), line([...'x.md'], true)])
    register(term, fakeMeta())
    for (const y of [1, 2]) {
      expect(provided(term, y)!.map((l) => [l.text, l.range])).toEqual([
        ['https://e.io/x.md', { start: { x: 1, y: 1 }, end: { x: 4, y: 2 } }]
      ])
    }
  })

  it('클릭은 이벤트와 글자를 그대로 activate 에 넘긴다', () => {
    const got: [MouseEvent, string][] = []
    const term = fakeTerm(['https://x.io'])
    register(term, fakeMeta(), (e, t) => got.push([e, t]))
    const [link] = provided(term, 1)!
    const event = { metaKey: true } as MouseEvent
    link.activate(event, link.text)
    expect(got).toEqual([[event, 'https://x.io']])
  })

  it('밑줄·포인터는 ⌘ 를 누른 동안만이고, 올려 둔 채 누르거나 떼면 따라 바뀐다', async () => {
    const meta = fakeMeta()
    const term = fakeTerm(['https://x.io'])
    const registration = register(term, meta)
    const [link] = provided(term, 1)!
    expect(link.decorations).toEqual({ pointerCursor: false, underline: false })

    link.hover!({} as MouseEvent, link.text)
    // xterm 이 hover 뒤에 끼우는 자기 decorations 객체.
    link.decorations = { pointerCursor: false, underline: false }
    meta.press(true)
    expect(link.decorations).toEqual({ pointerCursor: true, underline: true })
    meta.press(false)
    expect(link.decorations).toEqual({ pointerCursor: false, underline: false })

    // hover 한 뒤 xterm 이 객체를 바꾸기 전에 누른 ⌘ 도 보인다.
    meta.press(true)
    link.hover!({} as MouseEvent, link.text)
    link.decorations = { pointerCursor: false, underline: false }
    await Promise.resolve()
    expect(link.decorations).toEqual({ pointerCursor: true, underline: true })

    link.leave!({} as MouseEvent, link.text)
    expect(link.decorations).toEqual({ pointerCursor: false, underline: false })
    meta.press(false)
    meta.press(true)
    expect(link.decorations).toEqual({ pointerCursor: false, underline: false })

    registration.dispose()
    expect(term.unregistered).toBe(true)
    link.hover!({} as MouseEvent, link.text)
    meta.press(false)
    expect(link.decorations).toEqual({ pointerCursor: false, underline: false })
  })
})

describe('createLinkHandler', () => {
  it('클릭을 activate 에 그대로 넘기고, 올리면 주소를, 떠나면 null 을 준다', () => {
    const got: [MouseEvent, string][] = []
    const hovered: (string | null)[] = []
    const h = createLinkHandler(
      (e, t) => got.push([e, t]),
      (u) => hovered.push(u)
    )
    const range = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } }
    const event = { metaKey: false } as MouseEvent
    h.activate(event, 'mailto:a@b.c', range)
    h.hover!({} as MouseEvent, 'https://x.io', range)
    h.leave!({} as MouseEvent, 'https://x.io', range)
    expect(got).toEqual([[event, 'mailto:a@b.c']])
    expect(hovered).toEqual(['https://x.io', null])
    expect(h.allowNonHttpProtocols).toBe(true)
  })
})
