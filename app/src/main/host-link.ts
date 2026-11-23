import type { HostEvent, KillRequest, OpenRequest, QuitRequest } from './pty-host'

/** main 이 pty host 로 쓰는 `UtilityProcess` 의 부분. */
export type HostProcess = {
  readonly pid?: number
  postMessage(message: unknown, transfer?: unknown[]): void
  on(event: 'message', listener: (msg: HostEvent) => void): unknown
  once(event: 'exit', listener: () => void): unknown
}

export type HostLinkDeps = {
  ready: Promise<unknown>
  fork: () => HostProcess
  onEvent: (msg: HostEvent) => void
  /** host 가 끝나면 부른다. */
  onExit: () => void
  quitTimeoutMs: number
  /** 멈춘 host 를 끝낸다. 멈춘 프로세스는 SIGTERM 을 처리하지 못하므로 SIGKILL 을 보낸다. */
  kill: (pid: number) => void
}

export type HostLink = {
  open(req: OpenRequest, port: unknown, toRenderer: () => void): void
  kill(req: KillRequest): void
  stop(keepPtys: boolean): Promise<void>
}

/**
 * open·kill·quit 을 모두 같은 `ready.then` 으로 보낸다. 그래서 host 는 quit 앞에 온 open·kill 을 먼저 받는다
 * (`docs/contracts/pty-lifecycle.md` 의 "`quit` 은 open 과 같은 `ready.then` 으로 보낸다").
 */
export function createHostLink(deps: HostLinkDeps): HostLink {
  let host: HostProcess | null = null
  const current = (): HostProcess => {
    if (!host) {
      const proc = deps.fork()
      proc.on('message', deps.onEvent)
      proc.once('exit', () => {
        host = null
        deps.onExit()
      })
      host = proc
    }
    return host
  }
  return {
    open(req, port, toRenderer) {
      void deps.ready.then(() => current().postMessage(req, [port]))
      // 포트는 host 에 넘기기(위 ready.then) 전에 renderer 에 보낸다. renderer 는 포트보다 먼저 온 pty:lost 를
      // 이 open 이전 host 의 것으로 보고 버리기 때문이다(renderer/src/pty/connection.ts).
      toRenderer()
    },
    kill(req) {
      void deps.ready.then(() => current().postMessage(req))
    },
    stop: (keepPtys) =>
      deps.ready.then(() => {
        const proc = host
        if (!proc) return
        return new Promise<void>((resolve) => {
          // 멈춘 host 를 기다리느라 앱이 끝나지 못하는 일이 없게 상한을 둔다. 상한이 지나 끝낸 host 가 띄우던 pty 가
          // 어떻게 되는지는 `docs/contracts/pty-lifecycle.md` 의 "pty 를 남기고 끝낼 때도 main 은 host 를 기다린다" 에 있다.
          const timer = setTimeout(() => {
            // host 가 방금 끝나 `exit` 이 아직 오지 않았으면 kill 이 실패한다.
            try {
              if (proc.pid) deps.kill(proc.pid)
            } catch {
              // 이미 끝났다.
            }
            resolve()
          }, deps.quitTimeoutMs)
          proc.once('exit', () => {
            clearTimeout(timer)
            resolve()
          })
          const req: QuitRequest = { type: 'quit', keepPtys }
          proc.postMessage(req)
        })
      })
  }
}
