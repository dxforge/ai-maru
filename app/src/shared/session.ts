const SESSION_ID = /^s-[0-9a-f]{8}$/

/** 세션 id 의 모양인지. 파일 경로를 만들기 전에 본다. */
export function isSessionId(v: unknown): v is string {
  return typeof v === 'string' && SESSION_ID.test(v)
}

/**
 * 칸을 만들 때 그 세션의 id 를 정한다. 셸은 뜨자마자 `maru` 로 자기 칸을 가리킬 수 있어, renderer 가
 * 세션이 뜬 뒤에 id 를 받으면 그 사이의 요청이 칸을 찾지 못한다.
 */
export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return `s-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}
