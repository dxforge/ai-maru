import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterAll, describe, expect, it } from 'vitest'
import { canvasPut, putCanvas } from './canvas'
import { InvalidParams } from './cli-server'

const dir = mkdtempSync(join(tmpdir(), 'maru-canvas-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

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
    await putCanvas(win, doc)
    expect(sent).toEqual([['canvas:put', doc]])
  })

  it('이미지는 부른 때의 파일 내용과 이름·형식을 보낸다', async () => {
    const { win, sent } = fakeWindow()
    const path = file('Shot.PNG', [1, 2, 3])
    await putCanvas(win, { id: 'b', kind: 'image', path })
    writeFileSync(path, Buffer.from([9]))
    expect(sent).toEqual([
      [
        'canvas:put',
        {
          id: 'b',
          kind: 'image',
          name: 'Shot.PNG',
          mime: 'image/png',
          bytes: Buffer.from([1, 2, 3])
        }
      ]
    ])
  })

  it('없는 파일이면 throw 하고 아무것도 보내지 않는다', async () => {
    const { win, sent } = fakeWindow()
    const path = join(dir, 'none.png')
    await expect(putCanvas(win, { id: 'c', kind: 'image', path })).rejects.toThrow()
    expect(sent).toEqual([])
  })

  it('디렉토리면 throw 하고 아무것도 보내지 않는다', async () => {
    const { win, sent } = fakeWindow()
    const path = join(dir, 'folder.png')
    mkdirSync(path)
    await expect(putCanvas(win, { id: 'e', kind: 'image', path })).rejects.toThrow()
    expect(sent).toEqual([])
  })

  it('이미지 확장자가 아니면 throw 하고 아무것도 보내지 않는다', async () => {
    const { win, sent } = fakeWindow()
    const path = file('notes.txt', [1])
    await expect(putCanvas(win, { id: 'd', kind: 'image', path })).rejects.toThrow(/not an image/)
    expect(sent).toEqual([])
  })
})

describe('canvasPut', () => {
  it('id 를 주면 그대로 쓰고, 제목과 함께 마크다운 문서로 넣는다', async () => {
    const { win, sent } = fakeWindow()
    const res = await canvasPut(() => win)({ text: '# hi', id: 'd', title: 't' })
    expect(res).toEqual({ id: 'd' })
    expect(sent).toEqual([['canvas:put', { id: 'd', kind: 'markdown', text: '# hi', title: 't' }]])
  })

  it('id 가 없으면 새로 만들어 돌려주고, 부를 때마다 다르다', async () => {
    const { win, sent } = fakeWindow()
    const put = canvasPut(() => win)
    const a = await put({ text: 'a' })
    const b = await put({ text: 'b' })
    expect(a.id).toEqual(expect.any(String))
    expect(a.id).not.toBe('')
    expect(a.id).not.toBe(b.id)
    expect(sent[0]).toEqual(['canvas:put', { id: a.id, kind: 'markdown', text: 'a' }])
  })

  it.each([
    [{}],
    [{ text: 1 }],
    [{ text: 'x', id: '' }],
    [{ text: 'x', id: 3 }],
    [{ text: 'x', title: null }]
  ])('params %j 는 InvalidParams 이고 아무것도 보내지 않는다', async (params) => {
    const { win, sent } = fakeWindow()
    await expect(canvasPut(() => win)(params)).rejects.toBeInstanceOf(InvalidParams)
    expect(sent).toEqual([])
  })

  it('창이 없거나 파괴됐으면 InvalidParams 가 아닌 오류로 던진다', async () => {
    const gone = fakeWindow(true)
    for (const window of [() => undefined, () => gone.win]) {
      const err = await canvasPut(window)({ text: 'x' }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(InvalidParams)
    }
    expect(gone.sent).toEqual([])
  })
})
