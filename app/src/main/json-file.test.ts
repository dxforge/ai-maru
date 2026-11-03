import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTmpFiles, writeJsonAtomic, writeJsonAtomicSync } from './json-file'

const opened = vi.hoisted(() => [] as string[])

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const writeFileSync: typeof fs.writeFileSync = (file, ...rest) => {
    opened.push(String(file))
    return fs.writeFileSync(file, ...rest)
  }
  return { ...fs, writeFileSync }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  const writeFile: typeof fs.writeFile = (file, ...rest) => {
    opened.push(String(file))
    return fs.writeFile(file, ...rest)
  }
  return { ...fs, writeFile }
})

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maru-json-'))
  path = join(dir, 'data.json')
  opened.length = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('writeJsonAtomic', () => {
  it('쓰기마다 다른 임시 파일에 쓰고, 다 쓰면 임시 파일을 남기지 않는다', async () => {
    writeJsonAtomicSync(path, { n: 1 })
    writeJsonAtomicSync(path, { n: 2 })
    await writeJsonAtomic(path, { n: 3 })
    await Promise.all([writeJsonAtomic(path, { n: 4 }), writeJsonAtomic(path, { n: 5 })])
    expect(opened).toHaveLength(5)
    expect(new Set(opened).size).toBe(5)
    expect(opened.every((p) => p.startsWith(`${path}.`))).toBe(true)
    expect(readdirSync(dir)).toEqual(['data.json'])
    // 동시에 쓴 둘 가운데 어느 쪽이 나중에 rename 될지는 정해져 있지 않다.
    expect([4, 5]).toContain(JSON.parse(readFileSync(path, 'utf8')).n)
  })

  it('쓰지 못하면 던지고 임시 파일을 지운다', async () => {
    // 디렉토리 위로는 rename 하지 못한다.
    mkdirSync(path)
    expect(() => writeJsonAtomicSync(path, { n: 1 })).toThrow()
    await expect(writeJsonAtomic(path, { n: 2 })).rejects.toThrow()
    expect(opened).toHaveLength(2)
    expect(readdirSync(dir)).toEqual(['data.json'])
  })

  it('임시 파일을 쓰지 못하면 그 오류를 던진다', async () => {
    const missing = join(dir, 'missing', 'data.json')
    expect(() => writeJsonAtomicSync(missing, { n: 1 })).toThrow(/ENOENT/)
    await expect(writeJsonAtomic(missing, { n: 2 })).rejects.toThrow(/ENOENT/)
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('removeTmpFiles', () => {
  it('그 파일의 임시 파일만 지운다', () => {
    const names = [
      'data.json',
      'data.json.tmp',
      'data.json.123.4.tmp',
      'data.json.bak',
      'other.json.123.4.tmp'
    ]
    for (const n of names) writeFileSync(join(dir, n), '{}')
    removeTmpFiles(path)
    expect(readdirSync(dir).sort()).toEqual(['data.json', 'data.json.bak', 'other.json.123.4.tmp'])
  })

  it('디렉토리가 없거나 지우지 못하는 항목이 있어도 던지지 않는다', () => {
    mkdirSync(`${path}.1.1.tmp`)
    expect(() => removeTmpFiles(path)).not.toThrow()
    expect(() => removeTmpFiles(join(dir, 'missing', 'data.json'))).not.toThrow()
  })
})
