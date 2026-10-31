// `maru` 의 `TIMEOUT`(main.rs)이 10초이므로, 창을 기다리다 낸 오류가 그 안에 닿게 한다.
export const WINDOW_WAIT_MS = 8_000

export interface WindowReady {
  whenReady(deliver: () => void): () => void
  ready(): void
  unready(): void
}

/**
 * renderer 가 리스너를 달기 전에 보낸 IPC 는 받는 쪽이 없어 버려진다(`docs/architecture.md` 의 "창에 보내는 요청은
 * 창이 준비된 뒤에 넘긴다"). 호출하는 쪽은 창이 준비됐다고 알리면 `ready` 를, 창이 새 문서로 바뀌면 `unready` 를
 * 부른다. 쌓인 `deliver` 는 온 순서대로 부른다.
 */
export function createWindowReady(): WindowReady {
  let isReady = false
  const waiting = new Set<() => void>()
  return {
    whenReady(deliver) {
      if (isReady) {
        deliver()
        return () => {}
      }
      waiting.add(deliver)
      return () => void waiting.delete(deliver)
    },
    ready() {
      isReady = true
      for (const deliver of [...waiting]) {
        waiting.delete(deliver)
        deliver()
      }
    },
    unready: () => void (isReady = false)
  }
}
