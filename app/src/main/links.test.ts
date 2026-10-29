import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { CanvasDoc } from '../shared/canvas'
import { longestExistingPaths, openLink, resolveLinkTarget, type LinkOpener } from './links'

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

  it('이 머신의 호스트 이름이 붙은 file: URL 은 경로로 푼다', () => {
    expect(resolveLinkTarget(`file://${hostname()}/tmp/a%20b.md`)).toEqual({
      kind: 'file',
      path: '/tmp/a b.md'
    })
    expect(resolveLinkTarget(`file://${hostname().toUpperCase()}/tmp/x.md`)).toEqual({
      kind: 'file',
      path: '/tmp/x.md'
    })
  })

  it('다른 호스트의 file: URL 은 풀지 않는다', () => {
    expect(() => resolveLinkTarget('file://other-host.invalid/tmp/x.md')).toThrow()
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
    expect(await openLink('https://a.io/x', 'p-1', o)).toEqual({ ok: true })
    expect(external).toEqual(['https://a.io/x'])
    const failing = opener({
      openExternal: () => Promise.reject(new Error('no app for scheme'))
    }).o
    expect(await openLink('weird://x', 'p-1', failing)).toEqual({
      ok: false,
      reason: 'no app for scheme'
    })
  })

  it('.md 는 Canvas 에 띄운다 — id 는 경로, 제목은 파일 이름', async () => {
    const path = join(dir, 'note.md')
    writeFileSync(path, '# hi')
    const { o, docs, paths } = opener()
    expect(await openLink(path, 'p-1', o)).toEqual({ ok: true })
    expect(docs).toEqual([{ id: path, kind: 'markdown', text: '# hi', title: 'note.md' }])
    expect(paths).toEqual([])
  })

  it('이미지는 Canvas 에 띄운다', async () => {
    const path = join(dir, 'shot.PNG')
    writeFileSync(path, 'x')
    const { o, docs } = opener()
    expect(await openLink(`file://${path}`, 'p-1', o)).toEqual({ ok: true })
    expect(docs).toEqual([{ id: path, kind: 'image', path }])
  })

  it('그 밖의 파일과 디렉토리는 OS 기본 앱으로 열고, OS 가 거절하면 그 이유를 준다', async () => {
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'x')
    const { o, paths, docs } = opener()
    expect(await openLink(file, 'p-1', o)).toEqual({ ok: true })
    expect(await openLink(`${dir}/:3`, 'p-1', o)).toEqual({ ok: true })
    expect(paths).toEqual([file, `${dir}/`])
    expect(docs).toEqual([])
    const refusing = opener({ openPath: async () => 'No application' }).o
    expect(await openLink(file, 'p-1', refusing)).toEqual({ ok: false, reason: 'No application' })
  })

  it('상대경로는 그 pty 의 foreground 프로세스 cwd 기준이고, 기준을 모르면 열지 않는다', async () => {
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
    expect(await openLink('./r.md:4', 'p-9', o)).toEqual({ ok: true })
    expect(asked).toEqual(['p-9'])
    expect(docs[0]).toMatchObject({ id: join(sub, 'r.md'), text: 'rel' })

    const unknown = opener().o
    expect(await openLink('r.md', 'p-9', unknown)).toEqual({
      ok: false,
      reason: "Can't tell which directory r.md is relative to"
    })
    const gone = opener({
      foregroundCwd: () => Promise.reject(new Error('pty p-9 is not running'))
    }).o
    expect(await openLink('r.md', 'p-9', gone)).toEqual({
      ok: false,
      reason: 'pty p-9 is not running'
    })
  })

  it('절대경로는 pty 에 묻지 않는다', async () => {
    const path = join(dir, 'abs.md')
    writeFileSync(path, 'x')
    const { o } = opener({ foregroundCwd: () => Promise.reject(new Error('asked')) })
    expect(await openLink(path, 'p-1', o)).toEqual({ ok: true })
  })

  it('없는 파일과 풀 수 없는 file: URL 은 이유와 함께 실패한다', async () => {
    const { o, paths } = opener()
    expect(await openLink(join(dir, 'none.md'), 'p-1', o)).toEqual({
      ok: false,
      reason: `${join(dir, 'none.md')} doesn't exist`
    })
    expect(await openLink('file:relative.md', 'p-1', o)).toMatchObject({ ok: false })
    expect(paths).toEqual([])
  })

  it('Canvas 에 띄우지 못하면(창 없음) 그 이유로 실패한다', async () => {
    const path = join(dir, 'gone.md')
    writeFileSync(path, 'x')
    const { o } = opener({ putCanvas: () => Promise.reject(new Error('no window')) })
    expect(await openLink(path, 'p-1', o)).toEqual({ ok: false, reason: 'no window' })
  })
})

describe('longestExistingPaths', () => {
  const root = join(dir, 'joined')
  mkdirSync(join(root, 'c769-299b'), { recursive: true })
  writeFileSync(join(root, 'c769-299b', 'robot.svg'), 'x')
  const cwdAt = (cwd: string | null) => ({ foregroundCwd: async () => cwd })
  const whole = (text: string) => ({ text, starts: [0], ends: [text.length] })

  it('후보 가운데 있는 가장 긴 것을 고르고, 있는 것이 없으면 null 이다', async () => {
    // 셋째 줄의 `after.md` 까지 이은 것은 없고, 둘째 줄까지 이은 것이 있다.
    const text = `${root}/c769-299b/robot.svgafter.md`
    const ends = [`${root}/c76`.length, `${root}/c769-299b/robot.svg`.length, text.length]
    expect(
      await longestExistingPaths(
        [{ text, starts: [0], ends }, whole(`${root}/none/x.md`)],
        'p-1',
        cwdAt(null)
      )
    ).toEqual([[0, ends[1]], null])
  })

  it('끝의 :줄:칸 은 떼고 보고, 경로 꼴이 아닌 후보는 있어도 고르지 않는다', async () => {
    const withPosition = `${root}/c769-299b/robot.svg:12`
    expect(await longestExistingPaths([whole(withPosition)], 'p-1', cwdAt(null))).toEqual([
      [0, withPosition.length]
    ])
    // 확장자로 끝나지 않는 디렉토리는 있지만 링크로 보는 경로 꼴이 아니다.
    expect(await longestExistingPaths([whole(`${root}/c769-299b`)], 'p-1', cwdAt(null))).toEqual([
      null
    ])
  })

  it('상대경로는 foreground 프로세스의 cwd 기준이고, 그 cwd 를 모르면 null 이다', async () => {
    const group = { text: 'x c769-299b/robot.svg', starts: [2], ends: [21] }
    expect(await longestExistingPaths([group], 'p-1', cwdAt(root))).toEqual([[2, 21]])
    expect(await longestExistingPaths([group], 'p-1', cwdAt(null))).toEqual([null])
    const failing = { foregroundCwd: () => Promise.reject(new Error('older maru-pty')) }
    expect(await longestExistingPaths([group], 'p-1', failing)).toEqual([null])
  })

  it('앞 줄의 글자까지 이은 것이 없으면 이음 자리에서 시작한 후보를 고른다', async () => {
    const text = 'zzc769-299b/robot.svg'
    expect(
      await longestExistingPaths(
        [{ text, starts: [0, 2], ends: [text.length] }],
        'p-1',
        cwdAt(root)
      )
    ).toEqual([[2, text.length]])
  })

  it('경로 줄이 길게 이어진 것을 이은 후보는 없는 디렉토리에서 끊어 빨리 끝낸다', async () => {
    // `git ls-files` 처럼 `dN/f.ts` 줄이 이어진 꼴. 시작과 끝이 400 개씩이라 후보는 8 만 개쯤이다.
    const pieces = Array.from({ length: 400 }, (_, i) => `d${i}/f.ts`)
    const text = pieces.join('')
    const joints = pieces.map((_, i) => pieces.slice(0, i).join('').length)
    const start = performance.now()
    expect(
      await longestExistingPaths(
        [{ text, starts: joints, ends: [...joints.slice(1), text.length] }],
        'p-1',
        cwdAt(root)
      )
    ).toEqual([null])
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
