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
    mkdirSync(dir)
    let notify!: () => void
    vi.mocked(watch).mockImplementationOnce(((
      _dir: string,
      listener: (e: string, n: string) => void
    ) => {
      notify = () => listener('change', 'config.toml')
      return Object.assign(new EventEmitter(), { close: () => {} })
    }) as never)
    vi.useFakeTimers()
    let n = 0
    stop = watchConfig(dir, () => n++)
    notify()
    vi.advanceTimersByTime(50)
    notify()
    vi.advanceTimersByTime(CONFIG_SETTLE_MS)
    expect(n).toBe(1)
  })

  it('한 번에 여러 번 쓰면 한 번만 부른다', async () => {
    mkdirSync(dir)
    writeFileSync(file, 'a = 1\n')
    const w = await watching()
    writeFileSync(file, '')
    writeFileSync(file, 'a = 2\n')
    await calls(w, 1)
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
    await vi.waitFor(() => expect(w.count()).toBeGreaterThanOrEqual(1), { timeout: 2000 })
    await sleep(CONFIG_SETTLE_MS * 2)
    const before = w.count()
    writeFileSync(file, 'a = 1\n')
    await calls(w, before + 1)
  })

  it('폴더를 지웠다 다시 만들어도 부른다', async () => {
    mkdirSync(dir)
    writeFileSync(file, 'a = 1\n')
    const w = await watching()
    rmSync(dir, { recursive: true })
    await vi.waitFor(() => expect(w.count()).toBeGreaterThanOrEqual(1), { timeout: 2000 })
    mkdirSync(dir)
    await sleep(CONFIG_SETTLE_MS * 2)
    const before = w.count()
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
