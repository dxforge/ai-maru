import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import {
  canvasDocFor,
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
      bytes: Buffer.from([1, 2, 3])
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
      text: 'a\r\n한글\n'
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

  it('UTF-8 로 읽히지 않으면 코드 문서가 아니다', async () => {
    expect(await canvasDocFor(file('latin1.txt', [0x63, 0x61, 0x66, 0xe9]))).toBeNull()
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
