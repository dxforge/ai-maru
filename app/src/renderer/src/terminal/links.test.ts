import type { IBufferRange, ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import type { FoundPath, PathCandidates } from '../../../shared/link'
import {
  createLinkHandler,
  detectLinks,
  joinedPaths,
  linkRange,
  readJoinedLines,
  readWrappedLine,
  registerLinkProvider,
  type Activate,
  type BufferLike,
  type CellLike,
  type LineLike,
  type LongestExisting,
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
    // "한 a/b.md" — 한(폭 2) 공백 a/b.md
    const l = line(['한', '', ' ', 'a', '/', 'b', '.', 'm', 'd', ' ', ' '])
    const { text, cells } = readWrappedLine(buffer([l]), 1)
    expect(text).toBe('한 a/b.md')
    const [link] = detectLinks(text)
    expect(linkRange(cells, link.startIndex, link.endIndex)).toEqual({
      start: { x: 4, y: 1 },
      end: { x: 9, y: 1 }
    })
  })

  it('surrogate pair 는 두 반쪽이 같은 글자 칸이고, 넓은 글자로 끝나는 링크는 둘째 글자 칸까지다', () => {
    const l = line(['😀', '', 'x', '한', ''])
    const { text, cells } = readWrappedLine(buffer([l]), 1)
    expect(text).toBe('😀x한')
    expect(cells.map((c) => c.x)).toEqual([0, 0, 2, 3])
    expect(linkRange(cells, 2, 4)).toEqual({ start: { x: 3, y: 1 }, end: { x: 5, y: 1 } })
  })

  it('빈 글자 칸은 공백이고 끝의 공백은 뗀다', () => {
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
  activate: Activate = () => {},
  longestExisting: LongestExisting = async (paths) => paths.map(() => null)
) => registerLinkProvider(term as unknown as Terminal, meta, activate, longestExisting)

/** `existing` 에 든 경로만 있는 것으로 보고, main 의 `longestExistingPaths` 처럼 후보마다 가장 긴 것을 고른다. */
function fakeFs(existing: string[]) {
  const asked: PathCandidates[][] = []
  const longestExisting: LongestExisting = async (paths) => {
    asked.push(paths)
    return paths.map(({ text, starts, ends }) => {
      let best: readonly [number, number] | null = null
      for (const s of starts)
        for (const e of ends)
          if (e > s && existing.includes(text.slice(s, e)) && (!best || e - s > best[1] - best[0]))
            best = [s, e]
      return best
    })
  }
  return { asked, longestExisting }
}

async function providedLater(
  term: ReturnType<typeof fakeTerm>,
  y: number
): Promise<[string, IBufferRange][] | undefined> {
  const links = await new Promise<ILink[] | undefined>((done) =>
    term.provider!.provideLinks(y, done)
  )
  return links?.map((l) => [l.text, l.range])
}

const range = (x1: number, y1: number, x2: number, y2: number): IBufferRange => ({
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 }
})

describe('줄 끝에서 끊겨 다음 줄에 이어 찍힌 경로', () => {
  // Claude Code 가 긴 경로를 끊어 찍은 꼴 — 둘째 줄은 앞에 공백 두 칸을 두고 이어진다.
  const split = ['  Path: /tmp/abc/c769', '  -299b/robot.svg', 'after']
  const whole = '/tmp/abc/c769-299b/robot.svg'

  it('이어 붙인 경로가 있으면 어느 줄에서 물어도 두 줄을 걸치는 링크 하나다', async () => {
    const term = fakeTerm(split)
    register(term, fakeMeta(), undefined, fakeFs([whole]).longestExisting)
    for (const y of [1, 2]) {
      expect(await providedLater(term, y)).toEqual([[whole, range(9, 1, 17, 2)]])
    }
  })

  it('이어 붙인 경로가 없으면 줄마다 따로 찾는다', async () => {
    const term = fakeTerm(split)
    register(term, fakeMeta(), undefined, fakeFs([]).longestExisting)
    expect(await providedLater(term, 1)).toBeUndefined()
    expect(await providedLater(term, 2)).toEqual([['-299b/robot.svg', range(3, 2, 17, 2)]])
  })

  it('이어 붙인 링크를 ⌘+클릭하면 이어 붙인 경로를 activate 에 넘긴다', async () => {
    const got: string[] = []
    const term = fakeTerm(split)
    register(term, fakeMeta(), (_e, t) => got.push(t), fakeFs([whole]).longestExisting)
    const links = await new Promise<ILink[] | undefined>((done) =>
      term.provider!.provideLinks(2, done)
    )
    links![0].activate({ metaKey: true } as MouseEvent, links![0].text)
    expect(got).toEqual([whole])
  })

  it('토큰 하나뿐인 가운데 줄을 지나 세 줄을 잇고, 가운데 줄에서 물어도 같다', async () => {
    const term = fakeTerm(['see /a/bb', '  cc/dd', '  ee.md', 'x'])
    register(term, fakeMeta(), undefined, fakeFs(['/a/bbcc/ddee.md']).longestExisting)
    for (const y of [1, 2, 3]) {
      expect(await providedLater(term, y)).toEqual([['/a/bbcc/ddee.md', range(5, 1, 7, 3)]])
    }
  })

  it('토큰이 여럿인 가운데 줄 너머는 잇지 않는다', async () => {
    const fs = fakeFs([])
    const term = fakeTerm(['see /a/bb', '  cc/dd.md x.md', '  ee.md'])
    register(term, fakeMeta(), undefined, fs.longestExisting)
    await providedLater(term, 1)
    expect(fs.asked).toEqual([[{ text: '/a/bbcc/dd.md', starts: [0], ends: [5, 13] }]])
  })

  it('이은 후보 가운데 있는 가장 긴 것을 쓰고, 나머지 글자는 줄마다 찾은 링크로 남긴다', async () => {
    // 셋째 줄까지 이으면 `/a/b.mdc/d.mdxx/y.md` 로 잡히지만 있는 것은 둘째 줄까지 이은 `/a/b.mdc/d.md` 다.
    const term = fakeTerm(['/a/b.md', 'c/d.md', 'xx/y.md and src/z.ts'])
    register(term, fakeMeta(), undefined, fakeFs(['/a/b.md', '/a/b.mdc/d.md']).longestExisting)
    expect(await providedLater(term, 1)).toEqual([['/a/b.mdc/d.md', range(1, 1, 6, 2)]])
    expect(await providedLater(term, 3)).toEqual([
      ['xx/y.md', range(1, 3, 7, 3)],
      ['src/z.ts', range(13, 3, 20, 3)]
    ])
  })

  it('이을 후보가 없으면 묻지 않고 바로 답한다', () => {
    const fs = fakeFs([])
    const term = fakeTerm(['go /a/b.md now', 'next line', '', 'solo/x.md'])
    register(term, fakeMeta(), undefined, fs.longestExisting)
    expect(provided(term, 1)!.map((l) => l.text)).toEqual(['/a/b.md'])
    expect(provided(term, 4)!.map((l) => l.text)).toEqual(['solo/x.md'])
    expect(fs.asked).toEqual([])
  })

  it('줄 끝에서 끊긴 URL 은 잇지 않는다', () => {
    const fs = fakeFs([])
    const term = fakeTerm(['https://e.io/aa', '  bb/c.md'])
    register(term, fakeMeta(), undefined, fs.longestExisting)
    expect(provided(term, 1)!.map((l) => l.text)).toEqual(['https://e.io/aa'])
    expect(fs.asked).toEqual([])
  })

  it('늦게 온 답은 그 뒤에 다른 줄을 물었으면 내지 않는다', async () => {
    let answer: (found: FoundPath[]) => void = () => {}
    const term = fakeTerm(split)
    register(term, fakeMeta(), undefined, () => new Promise((done) => (answer = done)))
    const late: (ILink[] | undefined)[] = []
    term.provider!.provideLinks(1, (links) => late.push(links))
    const first = answer
    term.provider!.provideLinks(2, () => {})
    first([[0, whole.length]])
    await new Promise((done) => setTimeout(done, 0))
    expect(late).toEqual([])
  })

  it('늦게 온 답은 그 뒤에 물은 줄이 바로 답했어도 내지 않는다', async () => {
    let answer: (found: FoundPath[]) => void = () => {}
    const term = fakeTerm([...split, '', 'go /x/y.md'])
    register(term, fakeMeta(), undefined, () => new Promise((done) => (answer = done)))
    const late: (ILink[] | undefined)[] = []
    term.provider!.provideLinks(1, (links) => late.push(links))
    expect(provided(term, 5)!.map((l) => l.text)).toEqual(['/x/y.md'])
    answer([[0, whole.length]])
    await new Promise((done) => setTimeout(done, 0))
    expect(late).toEqual([])
  })

  it('이어 붙인 링크와 겹치지 않는 줄마다 찾은 링크는 함께 낸다', async () => {
    const term = fakeTerm(['  Path: /tmp/abc/c769', '  -299b/robot.svg and a/b.md'])
    register(term, fakeMeta(), undefined, fakeFs([whole]).longestExisting)
    expect(await providedLater(term, 2)).toEqual([
      [whole, range(9, 1, 17, 2)],
      ['a/b.md', range(23, 2, 28, 2)]
    ])
  })

  it('main 에 묻다 실패하면 줄마다 찾은 링크를 낸다', async () => {
    const term = fakeTerm(split)
    register(term, fakeMeta(), undefined, () => Promise.reject(new Error('gone')))
    expect(await providedLater(term, 2)).toEqual([['-299b/robot.svg', range(3, 2, 17, 2)]])
  })
})

describe('readJoinedLines·joinedPaths', () => {
  it('앞 줄의 글자 전체와 다음 줄들의 앞 공백을 뺀 글자를 잇고, 이음 자리와 물은 줄의 자리를 준다', () => {
    const lines = readJoinedLines(buffer(['a /x/y', '  z.md'].map((r) => line([...r]))), 2)
    expect([lines.text, lines.joints, lines.start, lines.end]).toEqual(['a /x/yz.md', [6], 6, 10])
    expect(lines.cells.slice(6).map((c) => [c.x, c.y])).toEqual([
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 2]
    ])
    expect(joinedPaths(lines)).toEqual([
      { offset: 2, candidates: { text: '/x/yz.md', starts: [0, 4], ends: [8] } }
    ])
  })

  it('글자 칸이 십만 개를 넘는 접힌 줄과 그 이웃 줄도 읽는다', () => {
    const wide = Array.from({ length: 1040 }, (_, i) => line([...'x'.repeat(150)], i > 0))
    const rows = [line([...'see /a/b.md']), ...wide, line([...'after'])]
    for (const y of [1, 2, rows.length]) {
      expect(() => joinedPaths(readJoinedLines(buffer(rows), y))).not.toThrow()
    }
  })

  it('경로 줄이 길게 이어져도 PATH_MAX 를 넘는 곳에서 멈춘다', () => {
    const rows = Array.from({ length: 3000 }, (_, i) => line([...`d${i}/f.ts`]))
    const lines = readJoinedLines(buffer(rows), 1500)
    expect(lines.text.length).toBeLessThan(2 * 1024 + 100)
  })
})

describe('registerLinkProvider', () => {
  it('줄의 링크마다 1 기반 글자 칸 범위를 주고, 링크가 없는 줄과 버퍼 밖의 줄은 undefined 다', () => {
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
