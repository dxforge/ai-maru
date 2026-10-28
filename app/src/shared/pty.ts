/**
 * `attach` 면 pty 를 띄우지 않고 떠 있는 `id` 의 pty 에 붙는다(재시작으로 되살린 pane). `keep` 이면 maru-pty 를
 * `--keep` 으로 띄워, 명령이 끝나도 화면과 종료 상태가 남는다.
 */
export type PtyOpen = {
  id: string
  cell: string
  cwd?: string
  command?: string[]
  attach?: boolean
  keep?: boolean
}

/** maru-pty 의 `exit` 메시지·`status` 응답의 종료 상태. 둘 다 null 이면 종료 상태를 모른다. */
export type PtyExit = { code: number | null; signal: number | null }

const SIGINT = 2
const SIGINT_EXIT = 128 + SIGINT

/**
 * 종료 코드 130 과 시그널 2(SIGINT)는 실패로 보지 않는다. 사용자가 Ctrl-C 로 끈 명령이기 때문이다.
 */
export function failedExit({ code, signal }: PtyExit): boolean {
  if (signal !== null) return signal !== SIGINT
  return code !== null && code !== 0 && code !== SIGINT_EXIT
}

export function exitMessage({ code, signal }: PtyExit): string {
  return signal !== null ? `[exited with signal ${signal}]` : `[exited with code ${code}]`
}

const PTY_ID = /^p-[0-9a-f]{8}$/

/** 파일 경로를 만들기 전에 본다. */
export function isPtyId(v: unknown): v is string {
  return typeof v === 'string' && PTY_ID.test(v)
}

/**
 * pane 을 만들 때 그 pty 의 id 를 정한다. 셸은 뜨자마자 `maru` 로 자기 pane 을 가리킬 수 있다. pty 가 뜬
 * 뒤에 renderer 가 id 를 받으면 그 사이에 온 요청이 pane 을 찾지 못하기 때문이다.
 */
export function newPtyId(): string {
  return randomId('p')
}

export function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}
