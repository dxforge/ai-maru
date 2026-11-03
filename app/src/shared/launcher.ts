/**
 * 즐겨찾기 하나. `id` 는 항목을 구별하는 값이고, workspace 는 이 값으로 자기 항목을 가리킨다. `dir` 은 workspace 를 연
 * 디렉토리의 절대경로, `name` 은 런처로 열 때 붙일 workspace 이름이다. 같은 `dir` 의 항목이 여럿일 수 있다. `pins` 는
 * 이 workspace 에 핀을 꽂은 디렉토리의 절대경로로, 꽂은 순서다. 사이드바는 열린 cell 이 맡지 않은 핀을 닫힌 핀 줄로
 * 보인다.
 */
export type Favorite = { id: string; dir: string; name: string; pins?: string[] }

/**
 * `userData/launcher.json` 의 내용이다. `recent` 는 런처로 연 디렉토리의 절대경로로, 최근에 연 것이 앞이다. `favorites` 는
 * 넣은 순서다. `command` 는 마지막으로 띄운 명령(`launcher.commands` 의 항목 문자열, 셸이면 `SHELL`)이고, 띄운 적이
 * 없으면 null 이다.
 */
export type LauncherState = { recent: string[]; favorites: Favorite[]; command: string | null }

/** 명령 없이 셸만 여는 항목. `launcher.commands` 는 빈 항목을 받지 않으므로 그 항목과 겹치지 않는다. */
export const SHELL = ''

export type LaunchResult = { ok: true } | { ok: false; reason: string }

// macOS 의 파일 시스템은 이름의 유니코드 정규화를 가리지 않는다. Finder 가 만든 한글 이름(NFD)과 입력기로 친 이름(NFC)이
// 같은 디렉토리다.
// main 은 `path.resolve` 를 거친 경로를 저장한다. renderer 의 workspace 는 런처에 친 경로를 `..` 가 든 채로 연
// 디렉토리로 가진다. 그래서 `.`·`..`·겹친 `/` 도 풀어서 비교한다.
export function samePath(a: string, b: string): boolean {
  return lexicalPath(a.normalize('NFC')) === lexicalPath(b.normalize('NFC'))
}

function lexicalPath(p: string): string {
  const parts: string[] = []
  for (const part of p.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return (p.startsWith('/') ? '/' : '') + parts.join('/')
}

/** 핀 `dir` 을 끝에 더한다. 같은 디렉토리의 핀이 이미 있으면 `f` 를 그대로 돌려준다. */
export function withPin(f: Favorite, dir: string): Favorite {
  return f.pins?.some((p) => samePath(p, dir)) ? f : { ...f, pins: [...(f.pins ?? []), dir] }
}

/** 핀 `dir` 을 뺀다. 남은 핀이 없으면 `pins` 키도 없앤다. */
export function withoutPin({ pins, ...f }: Favorite, dir: string): Favorite {
  const rest = pins?.filter((p) => !samePath(p, dir))
  return rest?.length ? { ...f, pins: rest } : f
}

export function favoriteById(
  favorites: readonly Favorite[],
  id: string | undefined
): Favorite | undefined {
  return id === undefined ? undefined : favorites.find((f) => f.id === id)
}
