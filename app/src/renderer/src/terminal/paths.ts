// Claude Code(2.1.304 에서 확인했다)는 붙인 글자를 공백 뒤에 `/` 가 오는 곳에서 경로 여럿으로 나누고 백슬래시를 풀어 이미지 경로를 알아본다.
// 작은따옴표로 감싸면 Claude Code 가 경로 둘을 나누지 못하고 `'\''` 도 풀지 않는다. 그래서 백슬래시로 escape 한다.
const SHELL_SPECIAL = /[^\w\-./:@%+=,\u0080-\uffff]/g
// bracketed paste 를 켜지 않은 셸은 제어문자를 키로 받아, `^V`·개행이 든 이름을 붙이면 쳐 둔 줄이 실행된다.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/
// eslint-disable-next-line no-control-regex
const ANSI_C_SPECIAL = /[\\'\x00-\x1f\x7f]/g

function quote(path: string): string {
  if (!CONTROL.test(path)) return path.replace(SHELL_SPECIAL, '\\$&')
  const body = path.replace(ANSI_C_SPECIAL, (c) =>
    c === '\\' || c === "'" ? `\\${c}` : `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
  )
  return `$'${body}'`
}

/** 이어서 치는 글자가 마지막 경로에 붙지 않게 끝에 공백을 둔다. */
export function pastePaths(paths: readonly string[]): string {
  const quoted = paths.filter((p) => p !== '').map((p) => quote(p.normalize('NFC')))
  return quoted.length ? `${quoted.join(' ')} ` : ''
}
