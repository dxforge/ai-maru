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
    expect(await createLauncherStore(file).read()).toEqual({
      recent: [],
      favorites: [],
      command: null
    })
  })

  for (const [label, text] of [
    ['JSON 이 아니면', '{'],
    ['recent 가 배열이 아니면', '{"recent":"a","command":null}'],
    ['recent 에 문자열이 아닌 것이 있으면', '{"recent":[1],"command":null}'],
    ['command 가 문자열도 null 도 아니면', '{"recent":[],"command":1}']
  ]) {
    it(`${label} 빈 목록으로 시작한다`, async () => {
      writeFileSync(file, text)
      expect(await createLauncherStore(file).read()).toEqual({
        recent: [],
        favorites: [],
        command: null
      })
    })
  }

  it('띄운 디렉토리를 맨 앞으로 옮기고 명령을 기억해 파일에 쓴다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await store.launched(a, 'claude')
    await store.launched(b, 'claude')
    expect(await store.launched(a, 'codex')).toEqual({ ok: true })
    expect(await store.read()).toEqual({ recent: [a, b], favorites: [], command: 'codex' })
    expect(saved()).toEqual({ recent: [a, b], favorites: [], command: 'codex' })
    expect(await createLauncherStore(file).read()).toEqual({
      recent: [a, b],
      favorites: [],
      command: 'codex'
    })
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
    expect(await store.read()).toEqual({ recent: [a], favorites: [], command: 'claude' })
  })

  it('launchedCommand 는 명령만 기억하고 최근 목록은 바꾸지 않는다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    await store.launched(a, 'claude')
    await store.launchedCommand('codex')
    expect(await store.read()).toEqual({ recent: [a], favorites: [], command: 'codex' })
    expect(saved()).toEqual({ recent: [a], favorites: [], command: 'codex' })
  })

  it('forget 은 그 경로만 지운다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await store.launched(a, 'claude')
    await store.launched(b, 'claude')
    expect(await store.forget(a)).toEqual({ recent: [b], favorites: [], command: 'claude' })
    expect(saved()).toEqual({ recent: [b], favorites: [], command: 'claude' })
  })

  it('동시에 부른 쓰기가 서로를 덮지 않는다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await Promise.all([store.launched(a, 'claude'), store.launched(b, 'codex')])
    // `launched` 는 디렉토리 검사가 끝나는 순서대로 쓰므로 이 테스트는 순서를 보지 않는다. 둘 다 남고, 명령은 맨 앞
    // 디렉토리를 띄운 명령이다.
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
    expect(await store.forget(hangul)).toEqual({ recent: [a], favorites: [], command: 'claude' })
  })

  it('쓰지 못해도 띄우기는 막지 않고 목록을 그대로 두며, 다음 쓰기는 한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // 디렉토리 위로는 rename 하지 못한다.
    mkdirSync(file)
    const store = createLauncherStore(file)
    expect(await store.launched(join(dir, 'a'), 'claude')).toEqual({ ok: true })
    expect(await store.read()).toEqual({ recent: [], favorites: [], command: null })
    expect(await store.forget(join(dir, 'a'))).toEqual({ recent: [], favorites: [], command: null })
    rmSync(file, { recursive: true })
    expect(await store.launched(join(dir, 'b'), 'claude')).toEqual({ ok: true })
    expect(saved()).toEqual({ recent: [join(dir, 'b')], favorites: [], command: 'claude' })
  })
})

describe('createLauncherStore 의 즐겨찾기', () => {
  it('favorites 키가 없는 파일은 최근 목록을 살리고 즐겨찾기를 비운다', async () => {
    writeFileSync(file, JSON.stringify({ recent: ['/x'], command: 'claude' }))
    expect(await createLauncherStore(file).read()).toEqual({
      recent: ['/x'],
      favorites: [],
      command: 'claude'
    })
  })

  it('파일의 즐겨찾기를 읽고, 모르는 키는 버린다', async () => {
    writeFileSync(
      file,
      JSON.stringify({
        recent: [],
        favorites: [{ id: 'f-1', dir: '/work/app', name: 'app', extra: 1 }],
        command: null
      })
    )
    expect((await createLauncherStore(file).read()).favorites).toEqual([
      { id: 'f-1', dir: '/work/app', name: 'app' }
    ])
  })

  for (const [label, favorites] of [
    ['favorites 가 배열이 아니면', '{}'],
    ['항목이 객체가 아니면', '["/x"]'],
    ['name 이 없으면', '[{"id":"f-1","dir":"/x"}]'],
    ['id 가 없으면', '[{"dir":"/x","name":"x"}]'],
    ['id 가 문자열이 아니면', '[{"id":1,"dir":"/x","name":"x"}]'],
    ['dir 이 문자열이 아니면', '[{"id":"f-1","dir":1,"name":"x"}]']
  ]) {
    it(`${label} 빈 목록으로 시작한다`, async () => {
      writeFileSync(file, `{"recent":["/y"],"favorites":${favorites},"command":null}`)
      expect(await createLauncherStore(file).read()).toEqual({
        recent: [],
        favorites: [],
        command: null
      })
    })
  }

  it('넣은 순서대로 쌓고 파일에 쓰며, 최근 목록과 명령은 그대로 둔다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await store.launched(a, 'claude')
    await store.addFavorite({ id: 'f-b', dir: b, name: 'bee' })
    expect(await store.addFavorite({ id: 'f-a', dir: a, name: 'ay' })).toEqual({
      recent: [a],
      favorites: [
        { id: 'f-b', dir: b, name: 'bee' },
        { id: 'f-a', dir: a, name: 'ay' }
      ],
      command: 'claude'
    })
    expect(saved()).toEqual(await store.read())
    expect((await createLauncherStore(file).read()).favorites).toHaveLength(2)
  })

  it('같은 디렉토리를 다른 id 로 여러 번 넣을 수 있고, 경로는 풀어서 둔다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    await store.addFavorite({ id: 'f-1', dir: a, name: 'app' })
    await store.addFavorite({ id: 'f-2', dir: `${a}/../a/.`, name: 'app review' })
    expect((await store.read()).favorites).toEqual([
      { id: 'f-1', dir: a, name: 'app' },
      { id: 'f-2', dir: a, name: 'app review' }
    ])
  })

  it('이미 든 id 는 다시 넣지 않는다', async () => {
    const store = createLauncherStore(file)
    await store.addFavorite({ id: 'f-1', dir: join(dir, 'a'), name: 'app' })
    await store.addFavorite({ id: 'f-1', dir: join(dir, 'b'), name: 'other' })
    expect((await store.read()).favorites).toEqual([
      { id: 'f-1', dir: join(dir, 'a'), name: 'app' }
    ])
  })

  it('상대경로는 넣지 않는다', async () => {
    const store = createLauncherStore(file)
    expect((await store.addFavorite({ id: 'f-1', dir: 'a', name: 'a' })).favorites).toEqual([])
  })

  it('빼기와 이름 바꾸기는 id 로 찾고, 같은 디렉토리의 다른 항목은 건드리지 않는다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    await store.addFavorite({ id: 'f-1', dir: a, name: 'app' })
    await store.addFavorite({ id: 'f-2', dir: a, name: 'old' })
    expect((await store.renameFavorite('f-2', 'new')).favorites).toEqual([
      { id: 'f-1', dir: a, name: 'app' },
      { id: 'f-2', dir: a, name: 'new' }
    ])
    expect((await store.forgetFavorite('f-2')).favorites).toEqual([
      { id: 'f-1', dir: a, name: 'app' }
    ])
    expect(saved()).toEqual(await store.read())
  })

  it('없는 즐겨찾기를 빼거나 이름을 바꾸면 목록이 그대로다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    await store.addFavorite({ id: 'f-1', dir: a, name: 'app' })
    await store.renameFavorite('f-2', 'other')
    await store.forgetFavorite('f-2')
    expect((await store.read()).favorites).toEqual([{ id: 'f-1', dir: a, name: 'app' }])
  })
})

describe('createLauncherStore 의 핀', () => {
  it('핀은 그 즐겨찾기에 넣은 순서대로 쌓고, 경로는 풀어 두며 같은 디렉토리는 다시 넣지 않는다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    await store.addFavorite({ id: 'f-1', dir: a, name: 'app' })
    await store.addFavorite({ id: 'f-2', dir: a, name: 'other' })
    await store.addPin('f-1', join(a, 'y'))
    await store.addPin('f-1', join(a, 'x', '..', 'x'))
    await store.addPin('f-1', join(a, 'y') + '/')
    expect((await store.read()).favorites).toEqual([
      { id: 'f-1', dir: a, name: 'app', pins: [join(a, 'y'), join(a, 'x')] },
      { id: 'f-2', dir: a, name: 'other' }
    ])
    expect(saved()).toEqual(await store.read())
  })

  it('상대경로와 없는 즐겨찾기에는 핀을 넣지 않는다', async () => {
    const store = createLauncherStore(file)
    await store.addFavorite({ id: 'f-1', dir: join(dir, 'a'), name: 'app' })
    await store.addPin('f-1', 'a')
    await store.addPin('f-2', join(dir, 'a'))
    expect((await store.read()).favorites).toEqual([
      { id: 'f-1', dir: join(dir, 'a'), name: 'app' }
    ])
  })

  it('핀을 빼고, 마지막 핀을 빼면 pins 키를 지우되 즐겨찾기는 남긴다', async () => {
    const store = createLauncherStore(file)
    const a = join(dir, 'a')
    await store.addFavorite({ id: 'f-1', dir: a, name: 'app' })
    await store.addPin('f-1', join(a, 'x'))
    await store.addPin('f-1', join(a, 'y'))
    expect((await store.removePin('f-1', join(a, 'x') + '/')).favorites).toEqual([
      { id: 'f-1', dir: a, name: 'app', pins: [join(a, 'y')] }
    ])
    expect((await store.removePin('f-1', join(a, 'y'))).favorites).toEqual([
      { id: 'f-1', dir: a, name: 'app' }
    ])
  })

  it('파일의 핀을 읽고, 문자열 배열이 아니거나 빈 배열인 pins 는 버린다', async () => {
    writeFileSync(
      file,
      JSON.stringify({
        recent: [],
        favorites: [
          { id: 'f-1', dir: '/w', name: 'a', pins: ['/w/x'] },
          { id: 'f-2', dir: '/w', name: 'b', pins: [1] },
          { id: 'f-3', dir: '/w', name: 'c', pins: [] },
          { id: 'f-4', dir: '/w', name: 'd', pins: '/w/x' }
        ],
        command: null
      })
    )
    expect((await createLauncherStore(file).read()).favorites).toEqual([
      { id: 'f-1', dir: '/w', name: 'a', pins: ['/w/x'] },
      { id: 'f-2', dir: '/w', name: 'b' },
      { id: 'f-3', dir: '/w', name: 'c' },
      { id: 'f-4', dir: '/w', name: 'd' }
    ])
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
