import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLauncherStore, listDirs } from './launcher'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maru-launcher-'))
  file = join(dir, 'launcher.json')
  mkdirSync(join(dir, 'a'))
  mkdirSync(join(dir, 'b'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const saved = (): unknown => JSON.parse(readFileSync(file, 'utf8'))

describe('createLauncherStore', () => {
  it('파일이 없으면 빈 목록이다', async () => {
    expect(await createLauncherStore(file).read()).toEqual({ recent: [], command: null })
  })

  for (const [label, text] of [
    ['JSON 이 아니면', '{'],
    ['recent 가 배열이 아니면', '{"recent":"a","command":null}'],
    ['recent 에 문자열이 아닌 것이 있으면', '{"recent":[1],"command":null}'],
    ['command 가 문자열도 null 도 아니면', '{"recent":[],"command":1}']
  ]) {
    it(`${label} 빈 목록으로 시작한다`, async () => {
      writeFileSync(file, text)
      expect(await createLauncherStore(file).read()).toEqual({ recent: [], command: null })
    })
  }

  it('띄운 디렉토리를 맨 앞으로 옮기고 명령을 기억해 파일에 쓴다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await store.launched(a, 'claude')
    await store.launched(b, 'claude')
    expect(await store.launched(a, 'codex')).toEqual({ ok: true })
    expect(await store.read()).toEqual({ recent: [a, b], command: 'codex' })
    expect(saved()).toEqual({ recent: [a, b], command: 'codex' })
    expect(await createLauncherStore(file).read()).toEqual({ recent: [a, b], command: 'codex' })
  })

  it('없는 경로나 디렉토리가 아닌 경로는 이유를 주고 목록을 바꾸지 않는다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    await store.launched(a, 'claude')
    const missing = join(dir, 'missing')
    const plain = join(dir, 'plain')
    writeFileSync(plain, '')
    expect(await store.launched(missing, 'codex')).toEqual({
      ok: false,
      reason: `No such directory: ${missing}`
    })
    expect(await store.launched(plain, 'codex')).toEqual({
      ok: false,
      reason: `Not a directory: ${plain}`
    })
    expect(await store.launched('~nobody/a', 'codex')).toEqual({
      ok: false,
      reason: 'No such directory: ~nobody/a'
    })
    const closed = join(dir, 'closed')
    mkdirSync(closed, { mode: 0o600 })
    expect(await store.launched(closed, 'codex')).toEqual({
      ok: false,
      reason: `Permission denied: ${closed}`
    })
    expect(await store.read()).toEqual({ recent: [a], command: 'claude' })
  })

  it('forget 은 그 경로만 지운다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await store.launched(a, 'claude')
    await store.launched(b, 'claude')
    expect(await store.forget(a)).toEqual({ recent: [b], command: 'claude' })
    expect(saved()).toEqual({ recent: [b], command: 'claude' })
  })

  it('동시에 부른 쓰기가 서로를 덮지 않는다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await Promise.all([store.launched(a, 'claude'), store.launched(b, 'codex')])
    // 디렉토리 검사가 끝나는 순서대로 쓰므로 순서는 정하지 않는다. 둘 다 남고, 명령은 맨 앞 디렉토리를 띄운 명령이다.
    const s = saved() as { recent: string[]; command: string }
    expect([...s.recent].sort()).toEqual([a, b])
    expect(s.command).toBe(s.recent[0] === a ? 'claude' : 'codex')
  })

  it('같은 디렉토리를 가리키는 다른 표기(., .., //, 한글 NFD)는 한 행으로 둔다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    for (const p of [a, `${a}/.`, `${dir}//a`, `${a}/../a`]) await store.launched(p, 'claude')
    expect((await store.read()).recent).toEqual([a])

    const hangul = join(dir, '프로젝트'.normalize('NFD'))
    mkdirSync(hangul)
    await store.launched(hangul, 'claude')
    await store.launched(join(dir, '프로젝트'.normalize('NFC')), 'claude')
    expect((await store.read()).recent).toHaveLength(2)
    expect(await store.forget(hangul)).toEqual({ recent: [a], command: 'claude' })
  })

  it('쓰지 못해도 띄우기는 막지 않고 목록을 그대로 두며, 다음 쓰기는 한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mkdirSync(`${file}.tmp`)
    const store = createLauncherStore(file)
    expect(await store.launched(join(dir, 'a'), 'claude')).toEqual({ ok: true })
    expect(await store.read()).toEqual({ recent: [], command: null })
    expect(await store.forget(join(dir, 'a'))).toEqual({ recent: [], command: null })
    rmSync(`${file}.tmp`, { recursive: true })
    expect(await store.launched(join(dir, 'b'), 'claude')).toEqual({ ok: true })
    expect(saved()).toEqual({ recent: [join(dir, 'b')], command: 'claude' })
  })
})

describe('listDirs', () => {
  it('이름순은 대소문자를 가리지 않는다', async () => {
    mkdirSync(join(dir, 'Alpha'))
    mkdirSync(join(dir, 'Zeta'))
    expect(await listDirs(dir)).toEqual(['a', 'Alpha', 'b', 'Zeta'])
  })

  it('하위 디렉토리와 디렉토리를 가리키는 링크만 이름순으로 주고, 숨은 디렉토리도 준다', async () => {
    mkdirSync(join(dir, '.hidden'))
    writeFileSync(join(dir, 'file'), '')
    symlinkSync(join(dir, 'a'), join(dir, 'link-dir'))
    symlinkSync(join(dir, 'file'), join(dir, 'link-file'))
    symlinkSync(join(dir, 'gone'), join(dir, 'link-broken'))
    expect(await listDirs(dir)).toEqual(['.hidden', 'a', 'b', 'link-dir'])
  })

  it('읽을 수 없으면 빈 목록이다', async () => {
    expect(await listDirs(join(dir, 'missing'))).toEqual([])
  })
})
