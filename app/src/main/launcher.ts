import { constants } from 'node:fs'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { samePath, type LaunchResult, type LauncherState, type Favorite } from '../shared/launcher'
import { writeJsonAtomic } from './json-file'

const EMPTY: LauncherState = { recent: [], favorites: [], command: null }

export function isFavorite(v: unknown): v is Favorite {
  if (typeof v !== 'object' || v === null) return false
  const { id, dir, name } = v as Record<string, unknown>
  return typeof id === 'string' && typeof dir === 'string' && typeof name === 'string'
}

// `favorites` 를 더하기 전에 쓴 파일에는 그 키가 없다.
function parseState(v: unknown): LauncherState | null {
  if (typeof v !== 'object' || v === null) return null
  const { recent, favorites = [], command } = v as Record<string, unknown>
  if (!Array.isArray(recent) || !recent.every((p) => typeof p === 'string')) return null
  if (!Array.isArray(favorites) || !favorites.every(isFavorite)) return null
  if (command !== null && typeof command !== 'string') return null
  return { recent, favorites: favorites.map(({ id, dir, name }) => ({ id, dir, name })), command }
}

async function readState(path: string): Promise<LauncherState> {
  try {
    return parseState(JSON.parse(await readFile(path, 'utf8'))) ?? EMPTY
  } catch {
    return EMPTY
  }
}

/** 여러 창이 이 파일을 함께 쓰므로 main 만 파일을 쓴다. 쓰기는 하나씩 차례로 해서, 동시에 온 요청이 서로를 덮지 않게 한다. */
export function createLauncherStore(path: string) {
  let state: Promise<LauncherState> | undefined
  const current = (): Promise<LauncherState> => (state ??= readState(path))

  function update(change: (s: LauncherState) => LauncherState): Promise<LauncherState> {
    state = current()
      .then(async (s) => {
        const next = change(s)
        await writeJsonAtomic(path, next)
        return next
      })
      .catch((err) => {
        console.error(`maru: cannot write ${path}:`, err)
        return readState(path)
      })
    return state
  }

  return {
    read: current,
    async launched(input: string, command: string): Promise<LaunchResult> {
      const reason = await notDirectory(input)
      if (reason) return { ok: false, reason }
      const dir = resolve(input)
      await update((s) => ({
        ...s,
        recent: [dir, ...s.recent.filter((p) => !samePath(p, dir))],
        command
      }))
      return { ok: true }
    },
    /** chord 로 띄운 명령은 디렉토리를 고른 것이 아니라 pane 의 디렉토리를 쓰므로, 명령만 기억하고 최근 목록은 그대로 둔다. */
    async launchedCommand(command: string): Promise<void> {
      await update((s) => ({ ...s, command }))
    },
    forget(dir: string): Promise<LauncherState> {
      return update((s) => ({ ...s, recent: s.recent.filter((p) => !samePath(p, dir)) }))
    },
    /** 상대경로는 main 의 작업 디렉토리를 기준으로 읽히므로 받지 않는다. */
    addFavorite({ id, dir, name }: Favorite): Promise<LauncherState> {
      if (!isAbsolute(dir)) return current()
      const at = resolve(dir)
      return update((s) =>
        s.favorites.some((f) => f.id === id)
          ? s
          : { ...s, favorites: [...s.favorites, { id, dir: at, name }] }
      )
    },
    forgetFavorite(id: string): Promise<LauncherState> {
      return update((s) => ({ ...s, favorites: s.favorites.filter((f) => f.id !== id) }))
    },
    renameFavorite(id: string, name: string): Promise<LauncherState> {
      return update((s) => ({
        ...s,
        favorites: s.favorites.map((f) => (f.id === id ? { ...f, name } : f))
      }))
    }
  }
}

/**
 * pty 를 띄우는 `startDir`(`pty.ts`)이 `$HOME` 으로 바꿔 띄우는 디렉토리를 미리 거른다. 상대경로는 main 의 작업
 * 디렉토리를 기준으로 읽히므로 받지 않는다(`~user` 처럼 풀지 않은 입력).
 */
async function notDirectory(dir: string): Promise<string | null> {
  if (!isAbsolute(dir)) return `No such directory: ${dir}`
  try {
    if (!(await stat(dir)).isDirectory()) return `Not a directory: ${dir}`
  } catch {
    return `No such directory: ${dir}`
  }
  try {
    await access(dir, constants.X_OK)
    return null
  } catch {
    return `Permission denied: ${dir}`
  }
}

export async function listDirs(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = await Promise.all(
    entries.map(async (e) => {
      if (e.isDirectory()) return e.name
      if (!e.isSymbolicLink()) return null
      try {
        return (await stat(join(dir, e.name))).isDirectory() ? e.name : null
      } catch {
        return null
      }
    })
  )
  return dirs
    .filter((n): n is string => n !== null)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
