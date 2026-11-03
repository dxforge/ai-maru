import { readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

// 제자리 truncate 로 쓰면 그 사이 앱이 죽을 때 깨진 파일이 남는다.

let written = 0

/**
 * 쓰기마다 다른 임시 파일을 쓴다. 두 쓰기가 같은 임시 파일을 열면, 늦게 쓴 쪽의 내용이 먼저 rename 된 파일 위에 덮여
 * JSON 뒤에 앞 내용의 꼬리가 남을 수 있기 때문이다.
 */
function tmpPath(path: string): string {
  return `${path}.${process.pid}.${++written}.tmp`
}

/**
 * 쓰다가 앱이 죽어 남은 `path` 의 임시 파일을 지운다. 이름이 쓰기마다 달라 다음 쓰기가 덮어쓰지 않기 때문이다.
 * 같은 파일을 쓰는 다른 프로세스가 없을 때(single instance lock 을 잡은 뒤)만 부른다.
 */
export function removeTmpFiles(path: string): void {
  const name = basename(path)
  let names: string[]
  try {
    names = readdirSync(dirname(path))
  } catch {
    return
  }
  for (const n of names) {
    if (!n.startsWith(`${name}.`) || !n.endsWith('.tmp')) continue
    try {
      rmSync(join(dirname(path), n), { force: true })
    } catch {
      // 지우지 못한 임시 파일은 다음 실행에 다시 지운다. 그 때문에 앱이 뜨지 못하면 안 된다.
    }
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = tmpPath(path)
  try {
    await writeFile(tmp, JSON.stringify(value), { mode: 0o600 })
    await rename(tmp, path)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

export function writeJsonAtomicSync(path: string, value: unknown): void {
  const tmp = tmpPath(path)
  try {
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
    renameSync(tmp, path)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}
