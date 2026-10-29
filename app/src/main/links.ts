import { stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CanvasDoc } from '../shared/canvas'
import {
  isPathText,
  type FoundPath,
  type LinkOpenResult,
  type PathCandidates
} from '../shared/link'
import { canvasDocFor } from './canvas'

export type LinkTarget = { kind: 'external'; url: string } | { kind: 'file'; path: string }

// RFC 3986 scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

/**
 * 파일로 보는 것은 `file:` URL 과 scheme 이 없는 경로뿐이다. 그 밖의 scheme 은 이름을 가리지 않고 OS 에 넘긴다.
 * `mailto:`·`vscode://` 를 경로로 잘못 보면 조용히 실패하기 때문이다. 경로 뒤의 `:줄:칸` 은 뗀다.
 * `file://host/x` 의 호스트가 이 머신의 이름이면 지운다(GNU `ls --hyperlink` 가 이 꼴로 찍는다). 다른 호스트면
 * `fileURLToPath` 가 throw 한다.
 */
export function resolveLinkTarget(text: string): LinkTarget {
  const scheme = SCHEME_RE.exec(text)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'file') return { kind: 'external', url: text }
  const path = scheme === 'file' ? fileURLToPath(withoutOwnHost(text)) : text
  return { kind: 'file', path: withoutPosition(path) }
}

const withoutPosition = (path: string): string => path.replace(/:\d+(?::\d+)?$/, '')

function withoutOwnHost(fileUrl: string): URL {
  const url = new URL(fileUrl)
  if (url.hostname.toLowerCase() === hostname().toLowerCase()) url.hostname = ''
  return url
}

export type LinkOpener = {
  openExternal(url: string): Promise<void>
  /** `shell.openPath` — 실패하면 그 이유, 열었으면 빈 문자열. */
  openPath(path: string): Promise<string>
  putCanvas(doc: CanvasDoc): Promise<void>
  foregroundCwd(ptyId: string): Promise<string | null>
}

/**
 * 상대경로는 그 pane 의 foreground 프로세스의 cwd 기준이다. 셸이 프롬프트마다 보내는 OSC 7 은 claude 가
 * 도는 동안 claude 가 바꾼 cwd(worktree 등)를 따라가지 못하기 때문이다. 기준을 모르면 짐작하지 않는다.
 */
export async function openLink(
  text: string,
  ptyId: string,
  opener: LinkOpener
): Promise<LinkOpenResult> {
  try {
    return await open(text, ptyId, opener)
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

async function open(text: string, ptyId: string, opener: LinkOpener): Promise<LinkOpenResult> {
  const target = resolveLinkTarget(text)
  if (target.kind === 'external') {
    await opener.openExternal(target.url)
    return { ok: true }
  }
  const path = await absolute(target.path, () => opener.foregroundCwd(ptyId))
  if (!path) {
    return { ok: false, reason: `Can't tell which directory ${target.path} is relative to` }
  }
  const info = await stat(path).catch(() => null)
  if (!info) return { ok: false, reason: `${path} doesn't exist` }
  const doc = info.isFile() ? await canvasDocFor(path) : null
  if (doc) {
    await opener.putCanvas(doc)
    return { ok: true }
  }
  const reason = await opener.openPath(path)
  return reason ? { ok: false, reason } : { ok: true }
}

async function absolute(path: string, cwd: () => Promise<string | null>): Promise<string | null> {
  if (isAbsolute(path)) return path
  const dir = await cwd()
  return dir ? resolve(dir, path) : null
}

/**
 * 후보마다 경로 꼴이고 실제로 있는 가장 긴 것을 고른다. 상대경로는 `openLink` 와 같이 foreground 프로세스의 cwd 기준이다.
 * 같은 시작에서 끝을 늘려 가다 디렉토리가 없으면 그 시작의 더 긴 후보는 보지 않는다. 더 긴 후보는 그 디렉토리 아래에 있기
 * 때문이다. 경로 줄이 길게 이어진 출력(`git ls-files`)에서 후보가 줄 수의 제곱만큼 생겨도 stat 은 줄 수만큼 부른다.
 */
export async function longestExistingPaths(
  groups: readonly PathCandidates[],
  ptyId: string,
  opener: Pick<LinkOpener, 'foregroundCwd'>
): Promise<FoundPath[]> {
  let cwd: Promise<string | null> | undefined
  const base = (): Promise<string | null> => (cwd ??= opener.foregroundCwd(ptyId).catch(() => null))
  const checked = new Map<string, Promise<boolean>>()
  const exists = (path: string): Promise<boolean> => {
    if (!checked.has(path))
      checked.set(
        path,
        stat(path).then(
          () => true,
          () => false
        )
      )
    return checked.get(path)!
  }
  return Promise.all(
    groups.map(async ({ text, starts, ends }) => {
      let best: FoundPath = null
      for (const start of starts) {
        for (const end of ends) {
          const candidate = text.slice(start, end)
          if (end <= start || !isPathText(candidate)) continue
          const path = await absolute(withoutPosition(candidate), base)
          if (!path || !(await exists(dirname(path)))) break
          if ((!best || end - start > best[1] - best[0]) && (await exists(path))) {
            best = [start, end]
          }
        }
      }
      return best
    })
  )
}
