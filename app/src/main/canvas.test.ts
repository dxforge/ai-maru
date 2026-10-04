import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterAll, describe, expect, it } from 'vitest'
import { putCanvas } from './canvas'

const dir = mkdtempSync(join(tmpdir(), 'maru-canvas-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function fakeWindow() {
  const sent: [string, unknown][] = []
  const win = { webContents: { send: (ch: string, v: unknown) => sent.push([ch, v]) } }
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
    await expect(putCanvas(win, { id: 'd', kind: 'image', path })).rejects.toThrow(/이미지/)
    expect(sent).toEqual([])
  })
})
