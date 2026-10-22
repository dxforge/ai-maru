import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { CanvasDoc } from '../shared/canvas'
import { openLink, resolveLinkTarget, type LinkOpener } from './links'

const dir = mkdtempSync(join(tmpdir(), 'maru-links-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveLinkTarget', () => {
  it('scheme 이 붙은 것은 이름을 가리지 않고 밖으로 보낸다', () => {
    for (const url of ['https://a.io/x', 'mailto:a@b.c', 'vscode://file/a.ts', 'obsidian://x']) {
      expect(resolveLinkTarget(url)).toEqual({ kind: 'external', url })
    }
  })

  it('file: URL 은 경로로 풀고 퍼센트 인코딩을 되돌린다', () => {
    expect(resolveLinkTarget('file:///tmp/a%20b/c.md')).toEqual({
      kind: 'file',
      path: '/tmp/a b/c.md'
    })
    expect(resolveLinkTarget('FILE:///tmp/x.md')).toEqual({ kind: 'file', path: '/tmp/x.md' })
  })

  it('경로 뒤의 :줄:칸 은 뗀다', () => {
    expect(resolveLinkTarget('/a/b.ts:12:3')).toEqual({ kind: 'file', path: '/a/b.ts' })
    expect(resolveLinkTarget('src/x.vue:7')).toEqual({ kind: 'file', path: 'src/x.vue' })
    expect(resolveLinkTarget('file:///a/b.ts:12')).toEqual({ kind: 'file', path: '/a/b.ts' })
  })
})

function opener(over: Partial<LinkOpener> = {}) {
  const external: string[] = []
  const paths: string[] = []
  const docs: CanvasDoc[] = []
  const o: LinkOpener = {
    openExternal: async (url) => void external.push(url),
    openPath: async (path) => {
      paths.push(path)
      return ''
    },
    putCanvas: async (doc) => void docs.push(doc),
    foregroundCwd: async () => null,
    ...over
  }
  return { o, external, paths, docs }
}

describe('openLink', () => {
  it('scheme 이 붙은 링크는 OS 가 열고, 거절하면 그 이유를 준다', async () => {
    const { o, external } = opener()
    expect(await openLink('https://a.io/x', 's-1', o)).toEqual({ ok: true })
    expect(external).toEqual(['https://a.io/x'])
    const failing = opener({
      openExternal: () => Promise.reject(new Error('no app for scheme'))
    }).o
    expect(await openLink('weird://x', 's-1', failing)).toEqual({
      ok: false,
      reason: 'no app for scheme'
    })
  })

  it('.md 는 Canvas 에 띄운다 — id 는 경로, 제목은 파일 이름', async () => {
    const path = join(dir, 'note.md')
    writeFileSync(path, '# hi')
    const { o, docs, paths } = opener()
    expect(await openLink(path, 's-1', o)).toEqual({ ok: true })
    expect(docs).toEqual([{ id: path, kind: 'markdown', text: '# hi', title: 'note.md' }])
    expect(paths).toEqual([])
  })

  it('이미지는 Canvas 에 띄운다', async () => {
    const path = join(dir, 'shot.PNG')
    writeFileSync(path, 'x')
    const { o, docs } = opener()
    expect(await openLink(`file://${path}`, 's-1', o)).toEqual({ ok: true })
    expect(docs).toEqual([{ id: path, kind: 'image', path }])
  })

  it('그 밖의 파일과 디렉토리는 OS 기본 앱으로 열고, OS 가 거절하면 그 이유를 준다', async () => {
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'x')
    const { o, paths, docs } = opener()
    expect(await openLink(file, 's-1', o)).toEqual({ ok: true })
    expect(await openLink(`${dir}/:3`, 's-1', o)).toEqual({ ok: true })
    expect(paths).toEqual([file, `${dir}/`])
    expect(docs).toEqual([])
    const refusing = opener({ openPath: async () => 'No application' }).o
    expect(await openLink(file, 's-1', refusing)).toEqual({ ok: false, reason: 'No application' })
  })

  it('상대경로는 그 세션의 foreground 프로세스 cwd 기준이고, 기준을 모르면 열지 않는다', async () => {
    const sub = join(dir, 'sub')
    mkdirSync(sub)
    writeFileSync(join(sub, 'r.md'), 'rel')
    const asked: string[] = []
    const { o, docs } = opener({
      foregroundCwd: async (id) => {
        asked.push(id)
        return sub
      }
    })
    expect(await openLink('./r.md:4', 's-9', o)).toEqual({ ok: true })
    expect(asked).toEqual(['s-9'])
    expect(docs[0]).toMatchObject({ id: join(sub, 'r.md'), text: 'rel' })

    const unknown = opener().o
    expect(await openLink('r.md', 's-9', unknown)).toEqual({
      ok: false,
      reason: "Can't tell which directory r.md is relative to"
    })
    const gone = opener({
      foregroundCwd: () => Promise.reject(new Error('session s-9 is not running'))
    }).o
    expect(await openLink('r.md', 's-9', gone)).toEqual({
      ok: false,
      reason: 'session s-9 is not running'
    })
  })

  it('절대경로는 세션에 묻지 않는다', async () => {
    const path = join(dir, 'abs.md')
    writeFileSync(path, 'x')
    const { o } = opener({ foregroundCwd: () => Promise.reject(new Error('asked')) })
    expect(await openLink(path, 's-1', o)).toEqual({ ok: true })
  })

  it('없는 파일과 풀 수 없는 file: URL 은 이유와 함께 실패한다', async () => {
    const { o, paths } = opener()
    expect(await openLink(join(dir, 'none.md'), 's-1', o)).toEqual({
      ok: false,
      reason: `${join(dir, 'none.md')} doesn't exist`
    })
    expect(await openLink('file:relative.md', 's-1', o)).toMatchObject({ ok: false })
    expect(paths).toEqual([])
  })

  it('Canvas 에 띄우지 못하면(창 없음) 그 이유로 실패한다', async () => {
    const path = join(dir, 'gone.md')
    writeFileSync(path, 'x')
    const { o } = opener({ putCanvas: () => Promise.reject(new Error('no window')) })
    expect(await openLink(path, 's-1', o)).toEqual({ ok: false, reason: 'no window' })
  })
})
