import type { ProgramStatusRecord } from '../shared/program-status'

export type SeenDeps = {
  /** main 이 그 pty 의 상태 구독으로 받아 든 레코드 */
  records(pty: string): readonly ProgramStatusRecord[]
  /** `maru` CLI 를 이 인자로 실행한다. */
  run(args: string[]): Promise<void>
}

/**
 * 레코드 `r` 을 idle 로 다시 쓰는 `maru` 인자. OSC 7501 보고는 레코드를 통째로 바꾸므로 id·app·title·message 를
 * 그대로 넘긴다. 빈 값은 옵션을 뺀다. CLI 는 빈 `--app` 을 거절한다. `--app` 이 없는 하위 레코드는 원래처럼 가장 가까운
 * 조상의 app 을 따른다.
 */
export function idleArgs(pty: string, r: ProgramStatusRecord): string[] {
  const args = ['status', 'put', 'idle', '--pty', pty]
  for (const [option, value] of [
    ['--id', r.id],
    ['--app', r.app],
    ['--title', r.title],
    ['--msg', r.message]
  ] as const) {
    if (value) args.push(option, value)
  }
  return args
}

/**
 * 사용자가 확인한 pane 의 done 레코드를 모두 idle 로 바꾼다. 레코드는 maru-pty 가 들고 있으므로 그 pty 의 터미널에
 * OSC 7501 을 쓴다 — 앱 메모리에서만 덮으면 앱을 다시 띄울 때 maru-pty 가 done 을 다시 보낸다.
 */
export function createSeen(deps: SeenDeps): (pty: string) => Promise<void> {
  return async (pty) => {
    for (const r of deps.records(pty)) {
      if (r.state !== 'done') continue
      try {
        await deps.run(idleArgs(pty, r))
      } catch (err) {
        console.error(
          `maru: cannot set the done record ${JSON.stringify(r.id)} of ${pty} to idle:`,
          err
        )
      }
    }
  }
}
