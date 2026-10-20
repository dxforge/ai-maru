const SHELL_SPECIAL = /[^\w\-./:@%+=,\u0080-\uffff]/g
// bracketed paste 를 켜지 않은 셸은 제어문자를 키 입력으로 받는다.
// 그래서 `^V`·개행이 든 이름을 붙이면 쳐 둔 줄이 실행된다.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/
// eslint-disable-next-line no-control-regex
const ANSI_C_SPECIAL = /[\\'\x00-\x1f\x7f]/g

// Claude Code(2.1.304 에서 확인했다)는 붙인 글자를 공백 뒤에 `/` 가 오는 곳에서 경로 여럿으로 나눈다.
// 나눈 경로마다 백슬래시를 풀어 이미지 경로인지 본다.
// `quote` 는 백슬래시로 escape 한다. 작은따옴표로 감싸면 Claude Code 가 경로 둘을 나누지 못하고 `'\''` 도 풀지 않기 때문이다.
function quote(path: string): string {
  if (!CONTROL.test(path)) return path.replace(SHELL_SPECIAL, '\\$&')
  const body = path.replace(ANSI_C_SPECIAL, (c) =>
    c === '\\' || c === "'" ? `\\${c}` : `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
  )
  return `$'${body}'`
}

/** 이어서 치는 글자가 마지막 경로에 붙지 않게 끝에 공백을 둔다. */
export function pastePaths(paths: readonly string[]): string {
  // 드롭한 경로는 디스크의 이름 그대로 오지만, Finder 복사의 file URL 은 디스크의 이름이 NFC 여도 NFD 로 온다.
  // 같은 파일을 드롭하든 붙여넣든 같은 글자로 붙게 NFC 로 맞춘다.
  const quoted = paths.filter((p) => p !== '').map((p) => quote(p.normalize('NFC')))
  return quoted.length ? `${quoted.join(' ')} ` : ''
}
