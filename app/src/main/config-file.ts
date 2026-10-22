import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { ConfigRead } from '../shared/config'

const FILE = 'config.toml'

export function configDir(): string {
  return process.env.MARU_CONFIG_DIR ?? join(homedir(), '.ai-maru')
}

export function configFile(): string {
  return join(configDir(), FILE)
}

export function readConfigFile(path: string): ConfigRead {
  try {
    return { path, text: readFileSync(path, 'utf8') }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { path, text: null }
    return { path, text: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 한 번의 저장에 오는 알림을 묶는 시간이다. vim `:w` 한 번에 알림 10개가 첫 알림부터 최대 40.9ms 에 걸쳐 왔다.
 * `writeFileSync` 와 임시 파일 `rename` 은 알림이 한꺼번에 왔다. 그래서 40.9ms 를 넘는 가장 작은 50ms 단위
 * 값으로 둔다.
 */
export const CONFIG_SETTLE_MS = 50

/**
 * `dir` 안의 `config.toml` 이 생기거나 바뀌거나 지워지면 `onChange` 를 부른다. vim 처럼 파일을 지우고 새로
 * 쓰는 저장에서는 파일 감시가 끊기므로 폴더를 감시한다. 폴더가 없으면 부모 폴더를 감시하다가 폴더가 생기면 그
 * 폴더를 감시한다.
 */
export function watchConfig(dir: string, onChange: () => void): () => void {
  let watcher: FSWatcher | undefined
  let timer: NodeJS.Timeout | undefined
  let stopped = false

  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => stopped || onChange(), CONFIG_SETTLE_MS)
  }

  const toParent = (): void => {
    watcher?.close()
    watchParent()
    schedule()
  }

  function watchDir(): boolean {
    try {
      watcher = watch(dir, (_event, name) => {
        if (!existsSync(dir)) toParent()
        else if (name === null || name === FILE) schedule()
      })
    } catch {
      return false
    }
    watcher.on('error', () => stopped || toParent())
    return true
  }

  function watchParent(): void {
    const name = basename(dir)
    try {
      watcher = watch(dirname(dir), (_event, changed) => {
        if ((changed !== null && changed !== name) || !existsSync(dir)) return
        watcher!.close()
        // 폴더가 생긴 뒤 폴더 감시를 걸기 전에 파일을 썼을 수 있으므로 `onChange` 를 한 번 부른다.
        if (watchDir()) schedule()
        else watchParent()
      })
    } catch (err) {
      console.error(`maru: cannot watch ${dirname(dir)} for the config file:`, err)
      watcher = undefined
    }
  }

  if (!watchDir()) watchParent()
  return () => {
    stopped = true
    clearTimeout(timer)
    watcher?.close()
  }
}
