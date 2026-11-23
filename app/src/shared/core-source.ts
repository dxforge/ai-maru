import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `core/` 아래 파일의 내용. 앱과 `core/` 의 크레이트가 함께 기대는 값을 앱의 테스트가 Rust 쪽 소스에서 읽어 견줄 때 쓴다.
 * 이 테스트들은 CI 의 app job 에서만 돌므로, 읽는 파일은 `.github/workflows/ci.yml` 의 app 경로에도 둔다.
 */
export function coreFile(path: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../core', path), 'utf8')
}

/** `core/` 의 파일에서 `pattern` 의 첫 캡처를 찾는다. 못 찾으면 던진다. 소스가 바뀌어 못 찾은 값을 테스트가 맞는 값으로 넘기면 안 되기 때문이다. */
export function coreMatch(path: string, pattern: RegExp): string {
  const found = coreFile(path).match(pattern)
  if (!found?.[1]) throw new Error(`${pattern} not found in core/${path}`)
  return found[1]
}
