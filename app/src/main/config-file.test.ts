import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_SETTLE_MS, readConfigFile, watchConfig } from './config-file'

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, watch: vi.fn(fs.watch) }
})

let root: string
let dir: string
let file: string
let stop: (() => void) | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maru-config-'))
  dir = join(root, '.ai-maru')
  file = join(dir, 'config.toml')
})

afterEach(() => {
  vi.useRealTimers()
  stop?.()
  stop = undefined
  rmSync(root, { recursive: true, force: true })
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// macOS 의 fs.watch(FSEvents)는 감시를 걸기 직전에 쓴 파일도 감시를 건 뒤에 알리곤 한다. 그 알림이
// 지나간 뒤부터 센다.
async function watching(): Promise<{ count: () => number }> {
  let n = 0
  stop = watchConfig(dir, () => n++)
  await sleep(500)
  const base = n
  return { count: () => n - base }
}

async function calls(w: { count: () => number }, n: number): Promise<void> {
  await vi.waitFor(() => expect(w.count()).toBe(n), { timeout: 2000 })
  await sleep(CONFIG_SETTLE_MS * 3)
  expect(w.count()).toBe(n)
}

async function watchedAfter(from: number, path: string): Promise<void> {
  const paths = (): unknown[] => vi.mocked(watch).mock.calls.map((c) => c[0])
  await vi.waitFor(() => expect(paths().slice(from)).toContain(path), { timeout: 2000 })
}

/**
 * 폴더가 생겨 `watchConfig` 가 폴더 감시를 다시 걸고, 그때 한 번 부르는 `onChange` 까지 지나간 뒤의 호출 수를
 * 준다. 마지막 `watch` 호출만 보면 `watching()` 이 처음 건 `watch(dir)` 로도 참이 되므로, 이 함수를 부른 뒤의
 * 호출을 본다.
 */
async function rewatched(w: { count: () => number }): Promise<number> {
  const seen = w.count()
  await watchedAfter(vi.mocked(watch).mock.calls.length, dir)
  await vi.waitFor(() => expect(w.count()).toBeGreaterThan(seen), { timeout: 2000 })
  await sleep(CONFIG_SETTLE_MS * 3)
  return w.count()
}

function fakeWatching(): { notify: () => void; count: () => number } {
  mkdirSync(dir)
  let listener!: (event: string, name: string) => void
  vi.mocked(watch).mockImplementationOnce(((_dir: string, l: typeof listener) => {
    listener = l
    return Object.assign(new EventEmitter(), { close: () => {} })
  }) as never)
  vi.useFakeTimers()
  let n = 0
  stop = watchConfig(dir, () => n++)
  return { notify: () => listener('change', 'config.toml'), count: () => n }
}

describe('readConfigFile', () => {
  it('파일이 없으면 text 가 null 이고 오류가 없다', () => {
    expect(readConfigFile(file)).toEqual({ path: file, text: null })
  })

  it('파일의 원문을 읽는다', () => {
    mkdirSync(dir)
    writeFileSync(file, '[terminal]\n')
    expect(readConfigFile(file)).toEqual({ path: file, text: '[terminal]\n' })
  })

  it('파일 자리에 폴더가 있으면 오류를 준다', () => {
    mkdirSync(file, { recursive: true })
    const read = readConfigFile(file)
    expect(read.text).toBeNull()
    expect(read.error).toMatch(/EISDIR/)
  })
})

describe('watchConfig', () => {
  it('있는 폴더에서 파일을 쓰면 한 번 부른다', async () => {
    mkdirSync(dir)
    const w = await watching()
    writeFileSync(file, 'a = 1\n')
    await calls(w, 1)
  })

  it('한 번의 저장 알림이 50ms 간격의 두 묶음으로 와도 한 번만 부른다', () => {
    const { notify, count } = fakeWatching()
    notify()
    vi.advanceTimersByTime(50)
    notify()
    vi.advanceTimersByTime(CONFIG_SETTLE_MS)
    expect(count()).toBe(1)
  })

  // 실제 파일을 두 번 쓰면 그 사이에 테스트 프로세스가 `CONFIG_SETTLE_MS` 넘게 멈출 때 두 번 불리므로, 알림을 묶는
  // 동작은 알림을 직접 보내 검사한다.
  it('한 번에 여러 번 써서 알림이 잇달아 와도 묶는 시간이 지난 뒤 한 번만 부른다', () => {
    const { notify, count } = fakeWatching()
    for (let i = 0; i < 4; i++) notify()
    vi.advanceTimersByTime(CONFIG_SETTLE_MS - 1)
    expect(count()).toBe(0)
    vi.advanceTimersByTime(1)
    expect(count()).toBe(1)
    vi.advanceTimersByTime(CONFIG_SETTLE_MS * 3)
    expect(count()).toBe(1)
  })

  it('임시 파일을 rename 해 덮어써도 계속 부른다', async () => {
    mkdirSync(dir)
    writeFileSync(file, 'a = 1\n')
    const w = await watching()
    for (const [i, n] of [
      [2, 1],
      [3, 2]
    ]) {
      writeFileSync(join(dir, 'tmp'), `a = ${i}\n`)
      renameSync(join(dir, 'tmp'), file)
      await calls(w, n)
    }
  })

  it('폴더가 없으면 폴더와 파일이 생길 때 부른다', async () => {
    const w = await watching()
    mkdirSync(dir)
    const before = await rewatched(w)
    writeFileSync(file, 'a = 1\n')
    await calls(w, before + 1)
  })

  it('폴더를 지웠다 다시 만들어도 부른다', async () => {
    mkdirSync(dir)
    writeFileSync(file, 'a = 1\n')
    const w = await watching()
    const from = vi.mocked(watch).mock.calls.length
    rmSync(dir, { recursive: true })
    // `watching()` 전에 쓴 파일의 알림이 늦게 와 호출 수가 먼저 차면, 부모 폴더 감시로 넘어가기 전에 폴더를 다시
    // 만들어 폴더 감시를 다시 거는 경로를 검사하지 못한다. 그래서 호출 수보다 부모 폴더 감시를 먼저 기다린다.
    await watchedAfter(from, root)
    await vi.waitFor(() => expect(w.count()).toBeGreaterThanOrEqual(1), { timeout: 2000 })
    mkdirSync(dir)
    const before = await rewatched(w)
    writeFileSync(file, 'a = 2\n')
    await calls(w, before + 1)
  })

  it('파일을 지우면 부른다', async () => {
    mkdirSync(dir)
    writeFileSync(file, 'a = 1\n')
    const w = await watching()
    rmSync(file)
    await calls(w, 1)
  })

  it('다른 파일의 변경에는 부르지 않는다', async () => {
    mkdirSync(dir)
    const w = await watching()
    writeFileSync(join(dir, 'other.txt'), 'x')
    await sleep(500)
    expect(w.count()).toBe(0)
  })

  it('끈 뒤에는 부르지 않는다', async () => {
    mkdirSync(dir)
    const w = await watching()
    stop!()
    writeFileSync(file, 'a = 1\n')
    await sleep(500)
    expect(w.count()).toBe(0)
  })
})
