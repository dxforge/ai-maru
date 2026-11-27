import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { Marked } from 'marked'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import {
  canvasDocFor,
  copyFormats,
  docSaver,
  fileDoc,
  canvasPaste,
  CODE_MAX_BYTES,
  canvasPut,
  putCanvas,
  type CellOf,
  type ClipboardEntry
} from './canvas'
import { InvalidParams } from './cli-server'
import { createWindowReady } from './window-ready'
import type { CanvasOwner } from '../shared/canvas'

const dir = mkdtempSync(join(tmpdir(), 'maru-canvas-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => vi.useRealTimers())

const noCell: CellOf = () => undefined
const noOwner = (): CanvasOwner => ({})

function readyWindow() {
  const windowReady = createWindowReady()
  windowReady.ready()
  return windowReady
}

function fakeWindow(destroyed = false) {
  const sent: [string, unknown][] = []
  const win = {
    isDestroyed: () => destroyed,
    webContents: { send: (ch: string, v: unknown) => sent.push([ch, v]) }
  }
  return { win: win as unknown as BrowserWindow, sent }
}

function file(name: string, bytes: number[]): string {
  const path = join(dir, name)
  writeFileSync(path, Buffer.from(bytes))
  return path
}

describe('putCanvas', () => {
  it('마크다운은 받은 그대로 보낸다', async () => {
    const { win, sent } = fakeWindow()
    const doc = { id: 'a', kind: 'markdown', text: '# hi', title: 't' } as const
    await putCanvas(() => win, readyWindow(), doc, noOwner)
    expect(sent).toEqual([['canvas:put', doc]])
  })
})

describe('canvasDocFor', () => {
  it('이미지는 부른 때의 파일 내용과 이름·형식을 든다', async () => {
    const path = file('Shot.PNG', [1, 2, 3])
    const doc = await canvasDocFor(path)
    writeFileSync(path, Buffer.from([9]))
    expect(doc).toEqual({
      id: path,
      kind: 'image',
      name: 'Shot.PNG',
      mime: 'image/png',
      bytes: Buffer.from([1, 2, 3]),
      path
    })
  })

  it('없는 이미지 파일이면 throw 한다', async () => {
    await expect(canvasDocFor(join(dir, 'none.png'))).rejects.toThrow()
  })

  it('이미지 이름의 디렉토리면 throw 한다', async () => {
    const path = join(dir, 'folder.png')
    mkdirSync(path)
    await expect(canvasDocFor(path)).rejects.toThrow()
  })

  it('`.md`·이미지가 아닌 텍스트 파일은 코드 문서다 — id 는 경로, 줄을 받으면 든다', async () => {
    const path = file('notes.txt', [...Buffer.from('a\r\n한글\n')])
    expect(await canvasDocFor(path)).toEqual({
      id: path,
      kind: 'code',
      name: 'notes.txt',
      text: 'a\r\n한글\n',
      path
    })
    expect(await canvasDocFor(path, 3)).toMatchObject({ kind: 'code', line: 3 })
    expect(await canvasDocFor(path, 0)).not.toHaveProperty('line')
    expect(await canvasDocFor(file('a.md', [...Buffer.from('# a')]), 3)).not.toHaveProperty('line')
    expect(await canvasDocFor(file('Makefile', []))).toMatchObject({ kind: 'code', text: '' })
  })

  it('앞 8000바이트에 NUL 이 있으면 코드 문서가 아니고, 그 뒤의 NUL 은 보지 않는다', async () => {
    expect(await canvasDocFor(file('a.dat', [0x41, 0, 0x42]))).toBeNull()
    expect(await canvasDocFor(file('b.dat', [...Array(7999).fill(0x41), 0]))).toBeNull()
    expect(await canvasDocFor(file('c.dat', [...Array(8000).fill(0x41), 0]))).toMatchObject({
      kind: 'code'
    })
  })

  it('`.mmd`·`.mermaid` 파일은 그 원문만 든 mermaid 블록 하나짜리 마크다운이다 — 줄은 받지 않는다', async () => {
    const source = 'graph TD\n  A["a ```` b"] --> B\n'
    for (const name of ['flow.mmd', 'Flow.MERMAID']) {
      const doc = await canvasDocFor(file(name, [...Buffer.from(source)]), 3)
      expect(doc).toMatchObject({ kind: 'markdown', title: name, id: join(dir, name) })
      expect(doc).not.toHaveProperty('line')
      const tokens = new Marked().lexer(doc!.kind === 'markdown' ? doc!.text : '')
      expect(tokens.filter((t) => t.type !== 'space')).toMatchObject([
        { type: 'code', lang: 'mermaid', text: source.trimEnd() }
      ])
    }
    const bare = await canvasDocFor(file('bare.mmd', [...Buffer.from('graph LR')]))
    expect(bare).toMatchObject({ text: '```mermaid\ngraph LR\n```\n' })
  })

  it('UTF-8 로 읽히지 않으면 코드 문서가 아니다', async () => {
    expect(await canvasDocFor(file('latin1.txt', [0x63, 0x61, 0x66, 0xe9]))).toBeNull()
  })

  it('`.markdown` 은 `.md` 처럼 파일 이름 제목의 마크다운이고, `.mdx` 는 코드 문서다', async () => {
    for (const name of ['note.markdown', 'Note.MARKDOWN']) {
      const path = file(name, [...Buffer.from('\uFEFF# 제목\n')])
      expect(await canvasDocFor(path, 3)).toEqual({
        id: path,
        kind: 'markdown',
        text: '# 제목\n',
        title: name,
        path
      })
    }
    expect(await canvasDocFor(file('page.mdx', [...Buffer.from('# a\n')]))).toMatchObject({
      kind: 'code',
      name: 'page.mdx'
    })
  })

  it('`.md`·`.mmd` 는 앞의 BOM 하나를 지우고 경로를 `path` 로 든다', async () => {
    const md = file('bom.md', [...Buffer.from('\uFEFF\uFEFF# 제목\n')])
    expect(await canvasDocFor(md)).toEqual({
      id: md,
      kind: 'markdown',
      text: '\uFEFF# 제목\n',
      title: 'bom.md',
      path: md
    })
    const mmd = file('bom.mmd', [...Buffer.from('\uFEFFgraph LR\n')])
    expect(await canvasDocFor(mmd)).toMatchObject({
      text: '```mermaid\ngraph LR\n```\n',
      path: mmd
    })
  })

  it('5 MiB 를 넘으면 코드 문서가 아니고, 꼭 5 MiB 면 코드 문서다', async () => {
    const path = join(dir, 'big.log')
    writeFileSync(path, Buffer.alloc(CODE_MAX_BYTES, 0x61))
    expect(CODE_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(await canvasDocFor(path)).toMatchObject({ kind: 'code' })
    writeFileSync(path, Buffer.alloc(CODE_MAX_BYTES + 1, 0x61))
    expect(await canvasDocFor(path)).toBeNull()
  })
})

describe('fileDoc', () => {
  it('그릴 수 없는 파일이면 그 이유를 돌려준다', async () => {
    const big = join(dir, 'huge.log')
    writeFileSync(big, Buffer.alloc(CODE_MAX_BYTES + 1, 0x61))
    expect(await fileDoc(big)).toBe(`${big} is larger than 5 MiB`)
    const nul = file('nul.dat', [0x41, 0])
    expect(await fileDoc(nul)).toBe(`${nul} is not a UTF-8 text file`)
    const latin1 = file('latin1.c', [0xe9])
    expect(await fileDoc(latin1)).toBe(`${latin1} is not a UTF-8 text file`)
  })
})

describe('창이 준비되기 전', () => {
  it('준비될 때까지 보내지 않고, 준비되면 온 순서대로 보낸 뒤 끝난다', async () => {
    const { win, sent } = fakeWindow()
    const windowReady = createWindowReady()
    let done = 0
    const first = putCanvas(
      () => win,
      windowReady,
      { id: 'a', kind: 'markdown', text: 'a' },
      noOwner
    ).then(() => done++)
    const second = putCanvas(
      () => win,
      windowReady,
      { id: 'b', kind: 'markdown', text: 'b' },
      noOwner
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(sent).toEqual([])
    expect(done).toBe(0)
    windowReady.ready()
    await Promise.all([first, second])
    expect(sent.map(([, item]) => (item as { id: string }).id)).toEqual(['a', 'b'])
  })

  it('쌓였다가 넘길 때 보내다 던지면 그 문서만 실패하고 뒤에 쌓인 것은 보낸다', async () => {
    const { win, sent } = fakeWindow()
    const broken = {
      isDestroyed: () => false,
      webContents: {
        send: () => {
          throw new Error('Object has been destroyed')
        }
      }
    } as unknown as BrowserWindow
    const windowReady = createWindowReady()
    let message = ''
    const first = putCanvas(
      () => broken,
      windowReady,
      {
        id: 'a',
        kind: 'markdown',
        text: 'a'
      },
      noOwner
    ).catch((e: Error) => void (message = e.message))
    const second = putCanvas(
      () => win,
      windowReady,
      { id: 'b', kind: 'markdown', text: 'b' },
      noOwner
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(() => windowReady.ready()).not.toThrow()
    await Promise.all([first, second])
    expect(message).toBe('Object has been destroyed')
    expect(sent.map(([, item]) => (item as { id: string }).id)).toEqual(['b'])
  })

  it('기다리는 시간을 넘기면 실패하고, 그 뒤 준비돼도 보내지 않는다', async () => {
    vi.useFakeTimers()
    const { win, sent } = fakeWindow()
    const windowReady = createWindowReady()
    let message = ''
    const caught = putCanvas(
      () => win,
      windowReady,
      {
        id: 'a',
        kind: 'markdown',
        text: 'a'
      },
      noOwner
    ).catch((e: Error) => void (message = e.message))
    await vi.advanceTimersByTimeAsync(7_999)
    expect(message).toBe('')
    await vi.advanceTimersByTimeAsync(1)
    await caught
    expect(message).toBe('the window was not ready within 8s')
    windowReady.ready()
    expect(sent).toEqual([])
  })

  it('canvas.put 도 창이 준비될 때까지 답하지 않는다', async () => {
    const { win, sent } = fakeWindow()
    const windowReady = createWindowReady()
    const res = canvasPut(() => win, windowReady, noCell)({ text: '# hi', id: 'd' }, 'p-1')
    await new Promise((r) => setTimeout(r, 10))
    expect(sent).toEqual([])
    windowReady.ready()
    await expect(res).resolves.toEqual({ id: 'd' })
    expect(sent).toHaveLength(1)
  })

  it('보낸 pty 의 cell 은 창이 준비된 뒤에 찾는다', async () => {
    const { win, sent } = fakeWindow()
    const windowReady = createWindowReady()
    // 재시작 직후처럼 renderer 가 pane 의 pty 를 다시 열기 전에는 main 이 그 pty 의 cell 을 모른다.
    const cells = new Map<string, string>()
    const res = canvasPut(
      () => win,
      windowReady,
      (pty) => cells.get(pty)
    )({ text: 'a', id: 'd' }, 'p-1')
    await new Promise((r) => setTimeout(r, 10))
    cells.set('p-1', 'c-1')
    windowReady.ready()
    await res
    expect(sent).toEqual([
      ['canvas:put', { id: 'd', kind: 'markdown', text: 'a', pty: 'p-1', cell: 'c-1' }]
    ])
  })
})

describe('canvasPut', () => {
  it('id 를 주면 그대로 쓰고, 제목과 함께 마크다운 문서로 넣는다', async () => {
    const { win, sent } = fakeWindow()
    const res = await canvasPut(
      () => win,
      readyWindow(),
      () => 'c-1'
    )({ text: '# hi', id: 'd', title: 't' }, 'p-1')
    expect(res).toEqual({ id: 'd' })
    expect(sent).toEqual([
      [
        'canvas:put',
        { id: 'd', kind: 'markdown', text: '# hi', title: 't', pty: 'p-1', cell: 'c-1' }
      ]
    ])
  })

  it('pty 의 cell 을 찾지 못하면 pty 만 붙인다', async () => {
    const { win, sent } = fakeWindow()
    await canvasPut(() => win, readyWindow(), noCell)({ text: 'a', id: 'd' }, 'p-1')
    expect(sent).toEqual([['canvas:put', { id: 'd', kind: 'markdown', text: 'a', pty: 'p-1' }]])
  })

  it('id 가 없으면 새로 만들어 돌려주고, 부를 때마다 다르다', async () => {
    const { win, sent } = fakeWindow()
    const put = canvasPut(() => win, readyWindow(), noCell)
    const a = await put({ text: 'a' }, 'p-1')
    const b = await put({ text: 'b' }, 'p-1')
    expect(a.id).toEqual(expect.any(String))
    expect(a.id).not.toBe('')
    expect(a.id).not.toBe(b.id)
    expect(sent[0]).toEqual(['canvas:put', { id: a.id, kind: 'markdown', text: 'a', pty: 'p-1' }])
  })

  it.each([
    [{}],
    [{ text: 1 }],
    [{ text: 'x', id: '' }],
    [{ text: 'x', id: 3 }],
    [{ text: 'x', title: null }]
  ])('params %j 는 InvalidParams 이고 아무것도 보내지 않는다', async (params) => {
    const { win, sent } = fakeWindow()
    await expect(canvasPut(() => win, readyWindow(), noCell)(params, 'p-1')).rejects.toBeInstanceOf(
      InvalidParams
    )
    expect(sent).toEqual([])
  })

  it.each([
    [{ text: 'x', path: '/a.md' }, 'params must have exactly one of text and path'],
    [{ path: 'a.md' }, 'params.path must be an absolute path'],
    [{ path: 3 }, 'params.path must be an absolute path'],
    [{ path: '' }, 'params.path must be an absolute path']
  ])('params %j 는 InvalidParams(%s)다', async (params, message) => {
    const { win, sent } = fakeWindow()
    const err = await canvasPut(
      () => win,
      readyWindow(),
      noCell
    )(params, 'p-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InvalidParams)
    expect((err as Error).message).toBe(message)
    expect(sent).toEqual([])
  })

  describe('path', () => {
    const put = async (params: Record<string, unknown>) => {
      const { win, sent } = fakeWindow()
      const res = await canvasPut(() => win, readyWindow(), noCell)(params, 'p-1')
      return { res, sent: sent.map(([, doc]) => doc) }
    }

    it('코드 파일은 코드 문서다 — id 와 path 는 정리한 경로이고 제목·줄은 없다', async () => {
      const path = file('repro.cjs', [...Buffer.from('const a = 1\n')])
      const { res, sent } = await put({ path: join(dir, '.', 'x', '..', 'repro.cjs') })
      expect(res).toEqual({ id: path })
      expect(sent).toEqual([
        { id: path, kind: 'code', name: 'repro.cjs', text: 'const a = 1\n', path, pty: 'p-1' }
      ])
    })

    it('id·title 을 주면 그것을 쓰고 path 는 파일 경로다', async () => {
      const path = file('shot.png', [1])
      const { res, sent } = await put({ path, id: 'shot', title: '화면' })
      expect(res).toEqual({ id: 'shot' })
      expect(sent).toMatchObject([{ id: 'shot', kind: 'image', title: '화면', path }])
    })

    it('`.md` 는 파일 이름을 제목으로 넣지 않고 BOM 을 지운 마크다운이다', async () => {
      const path = file('note.md', [...Buffer.from('\uFEFF# 제목\n')])
      const { sent } = await put({ path })
      expect(sent).toEqual([{ id: path, kind: 'markdown', text: '# 제목\n', path, pty: 'p-1' }])
    })

    it('`.markdown` 도 `.md` 처럼 제목을 넣지 않고 BOM 을 지운 마크다운이다', async () => {
      const path = file('note.markdown', [...Buffer.from('\uFEFF# 제목\n')])
      const { sent } = await put({ path })
      expect(sent).toEqual([{ id: path, kind: 'markdown', text: '# 제목\n', path, pty: 'p-1' }])
    })

    it('`.mmd` 는 다이어그램만 든 마크다운이다', async () => {
      const path = file('flow.mmd', [...Buffer.from('graph LR\n')])
      const { sent } = await put({ path })
      expect(sent).toEqual([
        { id: path, kind: 'markdown', text: '```mermaid\ngraph LR\n```\n', path, pty: 'p-1' }
      ])
    })

    it('그릴 수 없거나 읽을 수 없으면 그 이유로 InvalidParams 이고 아무것도 보내지 않는다', async () => {
      const empty = file('blank.md', [...Buffer.from(' \n\uFEFF')])
      const emptyLong = file('blank.markdown', [...Buffer.from('\uFEFF\n')])
      const binary = file('blob.bin', [0x41, 0])
      const missing = join(dir, 'missing.ts')
      const folder = join(dir, 'folder.ts')
      mkdirSync(folder, { recursive: true })
      // 일반 파일인지 먼저 보지 않으면 FIFO 를 읽다가 put 이 끝나지 않는다.
      const fifo = join(dir, 'fifo.ts')
      execFileSync('mkfifo', [fifo])
      const locked = file('locked.ts', [0x61])
      chmodSync(locked, 0)
      for (const [path, message] of [
        [empty, `${empty} is empty`],
        [emptyLong, `${emptyLong} is empty`],
        [binary, `${binary} is not a UTF-8 text file`],
        [missing, `cannot read ${missing}`],
        [folder, `${folder} is not a file`],
        [fifo, `${fifo} is not a file`],
        [locked, `cannot read ${locked}`]
      ]) {
        const { win, sent } = fakeWindow()
        const err = await canvasPut(
          () => win,
          readyWindow(),
          noCell
        )({ path }, 'p-1').catch((e: unknown) => e)
        expect(err, path).toBeInstanceOf(InvalidParams)
        expect((err as Error).message).toBe(message)
        expect(sent).toEqual([])
      }
    })
  })

  it('창이 없거나 파괴됐으면 InvalidParams 가 아닌 오류로 던진다', async () => {
    const gone = fakeWindow(true)
    for (const window of [() => undefined, () => gone.win]) {
      const err = await canvasPut(
        window,
        readyWindow(),
        noCell
      )({ text: 'x' }, 'p-1').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(InvalidParams)
    }
    expect(gone.sent).toEqual([])
  })
})

describe('canvasPaste', () => {
  const inC1: CellOf = () => 'c-1'
  const text: ClipboardEntry = {
    types: ['text/plain'],
    getType: () => Promise.reject(new Error('not on the clipboard'))
  }
  const emptyClipboard = () => Promise.resolve([text])
  const png = (bytes: number[]) => (): Promise<ClipboardEntry[]> =>
    Promise.resolve([
      text,
      {
        types: ['image/png'],
        getType: async () => new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      }
    ])

  it('클립보드에 PNG 가 없으면 아무것도 넣지 않는다', async () => {
    const { win, sent } = fakeWindow()
    await canvasPaste(() => win, readyWindow(), inC1, emptyClipboard).clipboard('p-1')
    expect(sent).toEqual([])
  })

  it('클립보드 이미지는 PNG 바이트를 붙인 pty 의 cell 에 Pasted image 로 넣는다', async () => {
    const { win, sent } = fakeWindow()
    await canvasPaste(() => win, readyWindow(), inC1, png([1, 2])).clipboard('p-1')
    expect(sent).toEqual([
      [
        'canvas:put',
        {
          id: expect.stringMatching(/^clipboard:/),
          kind: 'image',
          name: 'Pasted image',
          mime: 'image/png',
          bytes: Buffer.from([1, 2]),
          pty: 'p-1',
          cell: 'c-1'
        }
      ]
    ])
  })

  it('같은 클립보드 이미지를 두 번 붙이면 다른 문서 둘이다', async () => {
    const { win, sent } = fakeWindow()
    const paste = canvasPaste(() => win, readyWindow(), noCell, png([1]))
    await paste.clipboard('p-1')
    await paste.clipboard('p-1')
    const ids = sent.map(([, v]) => (v as { id: string }).id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('파일은 이미지 확장자인 것만 경로를 id 로, 받은 순서대로 넣는다', async () => {
    const { win, sent } = fakeWindow()
    const a = file('a.png', [1])
    const b = file('b.JPG', [2])
    const md = file('n.md', [35])
    await canvasPaste(() => win, readyWindow(), inC1, emptyClipboard).files('p-1', [
      a,
      md,
      join(dir, 'dir'),
      b
    ])
    expect(sent).toEqual([
      [
        'canvas:put',
        {
          id: a,
          kind: 'image',
          name: 'a.png',
          mime: 'image/png',
          bytes: Buffer.from([1]),
          path: a,
          pty: 'p-1',
          cell: 'c-1'
        }
      ],
      [
        'canvas:put',
        {
          id: b,
          kind: 'image',
          name: 'b.JPG',
          mime: 'image/jpeg',
          bytes: Buffer.from([2]),
          path: b,
          pty: 'p-1',
          cell: 'c-1'
        }
      ]
    ])
  })

  it('못 읽는 이미지 경로가 앞에 있어도 뒤의 이미지는 넣고, 끝에 실패를 알린다', async () => {
    const { win, sent } = fakeWindow()
    const folder = join(dir, 'paste-folder.png')
    mkdirSync(folder)
    const after = file('after.png', [2])
    const error = await canvasPaste(() => win, readyWindow(), inC1, emptyClipboard)
      .files('p-1', [folder, after])
      .catch((e: unknown) => e)
    expect(sent.map(([, item]) => (item as { id: string }).id)).toEqual([after])
    expect(error).toBeInstanceOf(AggregateError)
  })
})

describe('copyFormats', () => {
  it('HTML 이 없으면 text/plain 만, 있으면 text/plain 과 text/html 을 싣는다', () => {
    expect(copyFormats('# a', undefined)).toEqual({ 'text/plain': '# a' })
    expect(copyFormats('# a', '<h1>a</h1>')).toEqual({
      'text/plain': '# a',
      'text/html': '<h1>a</h1>'
    })
  })

  it('글자가 아닌 값은 받지 않는다', () => {
    expect(() => copyFormats(1, undefined)).toThrow()
    expect(() => copyFormats('a', 2)).toThrow()
  })
})

describe('docSaver', () => {
  const setup = (answers: (string | undefined)[]) => {
    const asked: string[] = []
    const written: [string, string | Uint8Array][] = []
    const save = docSaver(
      () => '/Users/me/Downloads',
      async (path) => {
        asked.push(path)
        return answers.shift()
      },
      async (path, data) => void written.push([path, data])
    )
    return { save, asked, written }
  }

  it('처음에는 다운로드 폴더에서 열고, 그 뒤로는 마지막으로 저장한 디렉토리에서 연다', async () => {
    const { save, asked, written } = setup(['/Users/me/notes/a.md', '/Users/me/b.png'])
    expect(await save('a.md', '# a')).toBe(true)
    expect(await save('b.png', new Uint8Array([1]))).toBe(true)
    expect(asked).toEqual(['/Users/me/Downloads/a.md', '/Users/me/notes/b.png'])
    expect(written).toEqual([
      ['/Users/me/notes/a.md', '# a'],
      ['/Users/me/b.png', new Uint8Array([1])]
    ])
  })

  it('취소하면 쓰지 않고, 다음 대화상자도 전과 같은 디렉토리에서 연다', async () => {
    const { save, asked, written } = setup([undefined, '/Users/me/x/c.md'])
    expect(await save('a.md', '# a')).toBe(false)
    expect(await save('c.md', '# c')).toBe(true)
    expect(asked).toEqual(['/Users/me/Downloads/a.md', '/Users/me/Downloads/c.md'])
    expect(written).toEqual([['/Users/me/x/c.md', '# c']])
  })

  it('대화상자가 떠 있는 동안 다시 저장하면 대화상자를 더 띄우지 않고 false 다', async () => {
    let answer!: (path: string | undefined) => void
    const asked: string[] = []
    const save = docSaver(
      () => '/Users/me/Downloads',
      (path) => (asked.push(path), new Promise((resolve) => (answer = resolve))),
      async () => {}
    )
    const first = save('a.md', '# a')
    expect(await save('a.md', '# a')).toBe(false)
    answer('/Users/me/a.md')
    expect(await first).toBe(true)
    const third = save('b.md', '# b')
    answer(undefined)
    expect(await third).toBe(false)
    expect(asked).toEqual(['/Users/me/Downloads/a.md', '/Users/me/b.md'])
  })

  it('쓰다 실패하면 그 디렉토리를 기억하지 않는다', async () => {
    const asked: string[] = []
    const save = docSaver(
      () => '/Users/me/Downloads',
      async (path) => (asked.push(path), '/Users/me/ro/a.md'),
      async () => {
        throw new Error('EACCES')
      }
    )
    await expect(save('a.md', '# a')).rejects.toThrow('EACCES')
    await expect(save('a.md', '# a')).rejects.toThrow('EACCES')
    expect(asked).toEqual(['/Users/me/Downloads/a.md', '/Users/me/Downloads/a.md'])
  })

  it('이름은 파일 이름만 쓰고, 이름·내용이 맞지 않으면 대화상자를 열지 않는다', async () => {
    const { save, asked } = setup(['/Users/me/a.md'])
    await save('../../etc/a.md', '# a')
    expect(asked).toEqual(['/Users/me/Downloads/a.md'])
    await expect(save('', '# a')).rejects.toThrow()
    await expect(save('a.md', 3)).rejects.toThrow()
    expect(asked).toHaveLength(1)
  })
})
