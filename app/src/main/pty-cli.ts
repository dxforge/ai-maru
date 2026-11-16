import { isPtyId, type PtyExit } from '../shared/pty'
import { ptyRows, type ListedJob } from '../shared/pty-list'
import type { PtyState } from '../shared/pty-state'
import { screenPanes, type ScreenState } from '../shared/screen'
import { InvalidParams, type Handlers } from './cli-server'

/** `pty.list`·`pty.read`·`pty.send`·`pty.kill` 의 핸들러다. 계약은 `maru` 의 모듈 doc(`core/crates/maru/src/main.rs`)이 정한다. */
export function ptyCli(deps: {
  screen: () => ScreenState | null
  jobs: () => readonly ListedJob[]
  state: (pty: string) => PtyState | undefined
  exit: (pty: string) => Promise<PtyExit | null>
  capture: (pty: string) => Promise<string>
  paste: (pty: string, text: string) => Promise<'written' | 'exited'>
  killJob: (pty: string) => Promise<void>
  closePty: (pty: string) => Promise<void>
  shell: string | undefined
  home: string | undefined
}): Handlers {
  function screen(): ScreenState {
    const s = deps.screen()
    if (!s) throw new Error('the window has not reported its layout yet')
    return s
  }

  function find(target: unknown): { pty: string; job: boolean } {
    if (!isPtyId(target)) throw new InvalidParams('params.target must be a pty id, e.g. p-1a2b3c4d')
    if (deps.jobs().some((j) => j.pty === target)) return { pty: target, job: true }
    if (!screenPanes(screen()).panes.some((p) => p.ptyId === target)) {
      throw new InvalidParams(`no pty ${target}`)
    }
    return { pty: target, job: false }
  }

  return {
    'pty.list': async () => {
      const s = screen()
      const panes = screenPanes(s).panes.map((p) => p.ptyId)
      const exits = await Promise.all(panes.map(deps.exit))
      const exitOf = new Map(panes.map((pty, i) => [pty, exits[i]]))
      return {
        ptys: ptyRows(
          s.workspaces,
          deps.jobs(),
          deps.state,
          (pty) => exitOf.get(pty) ?? null,
          deps.shell,
          deps.home
        )
      }
    },
    'pty.read': async ({ target }) => ({ text: await deps.capture(find(target).pty) }),
    'pty.send': async ({ target, text }) => {
      if (typeof text !== 'string' || text === '') {
        throw new InvalidParams('params.text must be a non-empty string')
      }
      const { pty } = find(target)
      if ((await deps.paste(pty, text)) === 'exited') throw new Error(`pty ${pty} has exited`)
      return null
    },
    'pty.kill': async ({ target }) => {
      const { pty, job } = find(target)
      await (job ? deps.killJob(pty) : deps.closePty(pty))
      return null
    }
  }
}
