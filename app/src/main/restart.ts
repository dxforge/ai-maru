import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { STATE_VERSIONS } from '../shared/screen'
import type { Dialog } from './close-confirm'
import { livePtys } from './pty'
import type { Outcome } from './state'

const run = promisify(execFile)

export async function ptyProtocol(bin: string): Promise<number | null> {
  try {
    const { stdout } = await run(bin, ['--protocol-version'])
    const v = stdout.trim()
    return /^\d+$/.test(v) ? Number(v) : null
  } catch {
    return null
  }
}

export async function installedVersions(path: string): Promise<typeof STATE_VERSIONS | null> {
  try {
    const v = JSON.parse(await readFile(path, 'utf8'))
    const keys = Object.keys(STATE_VERSIONS) as (keyof typeof STATE_VERSIONS)[]
    if (!keys.every((k) => Number.isInteger(v?.[k]))) return null
    return Object.fromEntries(keys.map((k) => [k, v[k]])) as typeof STATE_VERSIONS
  } catch {
    return null
  }
}

export type Incompatible = {
  ok: false
  reason: 'incompatible'
  /**
   * 다시 뜬 앱이 할 수 있는 복원 — `full` 이면 pty 에 다시 붙지만 `pins` 를 잃고, `layout` 이면 레이아웃만, `empty` 면
   * cell 을 모두 닫는다.
   */
  result: 'full' | 'layout' | 'empty'
  /** 꺼질 pty 수다. `full` 이면 pty 를 끄지 않으므로 0 이다. */
  ptys: number
  /** 설치된 `maru-pty` 의 프로토콜이 다르고 살아 있는 pty 가 있을 때만 있다. 버전을 알 수 없으면 null 이다. */
  protocol?: number | null
  formats: Format[]
  /** 설치된 번들에 형식 버전 파일이 없거나 읽지 못해, `formats` 를 모두 다른 것으로 보았다. */
  formatsUnknown?: true
}

export type RestartCheck = { ok: true } | { ok: false; reason: 'dev_server' } | Incompatible

type Format = 'layout' | 'sessions' | 'pins'

function restartResult(formats: Format[], protocolDiffers: boolean): Incompatible['result'] {
  if (formats.includes('layout')) return 'empty'
  return protocolDiffers || formats.includes('sessions') ? 'layout' : 'full'
}

/**
 * `bin`·`versionsFile` 은 다음에 뜰 앱의 것이다 — `scripts/install-app.sh` 는 같은 경로의 번들을 갈아 끼운다. 다시 뜬
 * 앱은 프로토콜이 다른 pty 에 붙지 못하고, 버전이 다른 부분을 버린다. `view` 의 버전이 달라도 보기 설정만 잃으므로
 * 묻지 않는다.
 */
export async function checkRestart(o: {
  devServer: boolean
  bin: string
  versionsFile: string
  dir: string
}): Promise<RestartCheck> {
  if (o.devServer) return { ok: false, reason: 'dev_server' }
  const [protocol, versions, live] = await Promise.all([
    ptyProtocol(o.bin),
    installedVersions(o.versionsFile),
    livePtys(o.dir)
  ])
  const formats = (['layout', 'sessions', 'pins'] as const).filter(
    (k) => versions?.[k] !== STATE_VERSIONS[k]
  )
  const protocolDiffers = protocol !== PROTOCOL_VERSION && live.length > 0
  if (!formats.length && !protocolDiffers) return { ok: true }
  const result = restartResult(formats, protocolDiffers)
  return {
    ok: false,
    reason: 'incompatible',
    result,
    ptys: result === 'full' ? 0 : live.length,
    ...(protocolDiffers && { protocol }),
    formats,
    ...(!versions && { formatsUnknown: true as const })
  }
}

/** 재시작하며 상태 파일에 남길 것이다. `full` 은 pty 에 다시 붙으므로 `keep` 이다. */
export function restartOutcome(check: RestartCheck): Outcome {
  if (check.ok) return 'keep'
  if (check.reason !== 'incompatible') return 'layout'
  const outcomes = { full: 'keep', layout: 'layout', empty: 'end' } as const
  return outcomes[check.result]
}

function reasons(check: Incompatible): string[] {
  const parts: string[] = []
  if (check.protocol !== undefined)
    parts.push(
      check.protocol === null
        ? `The installed app's pty protocol version couldn't be determined (this app uses version ${PROTOCOL_VERSION}).`
        : `The installed app uses pty protocol version ${check.protocol}, while this app uses version ${PROTOCOL_VERSION}.`
    )
  if (check.formatsUnknown)
    parts.push("The installed app's saved-state format couldn't be determined.")
  else if (check.formats.length) {
    const saved = check.formats.map((f) =>
      f === 'sessions' ? 'terminal sessions' : f === 'pins' ? 'workspace pins' : f
    )
    const last = saved.pop()
    const list = saved.length ? `${saved.join(', ')} and ${last}` : last
    parts.push(`The installed app uses a different format for the saved ${list}.`)
  }
  return parts
}

function restartDetail(check: Incompatible): string {
  const ending =
    check.ptys === 0
      ? []
      : [`This will end ${check.ptys} ${check.ptys === 1 ? 'terminal' : 'terminals'}.`]
  const after = {
    full: [],
    layout: ['The panes will reopen with new shells in their last directories.'],
    empty: ['All cells will close.']
  }[check.result]
  const pins = check.formats.includes('pins')
    ? [
        'Pinned workspaces will be unpinned and lose their custom names and favorites. Those with no cells will be removed.'
      ]
    : []
  return [...reasons(check), ...ending, ...after, ...pins].join(' ')
}

export function restartDialog(check: Incompatible): Dialog {
  const action = {
    full: 'Restart without workspace pins',
    layout: 'Restart with layout only',
    empty: 'Restart and close all cells'
  }[check.result]
  return { message: `${action}?`, detail: restartDetail(check), buttons: [action, 'Cancel'] }
}

export function restartRefusal(check: Incompatible): string {
  const result = {
    full: 'without workspace pins',
    layout: 'with the layout only',
    empty: 'and close all cells'
  }[check.result]
  return `${restartDetail(check)} Pass --kill-ptys to restart ${result}.`
}

export type RendererGone = { reason: string; exitCode: number }

export type RendererGoneChoice = 'restart' | 'quit'

export function rendererGoneDialog(
  gone: RendererGone,
  canRestart: boolean
): Dialog & { cancelId: number; choices: (RendererGoneChoice | null)[] } {
  const why = `The process for this window ended (reason: ${gone.reason}; exit code: ${gone.exitCode}).`
  if (!canRestart)
    return {
      message: 'The window stopped working.',
      detail: `${why} AI Maru can't restart itself when started by the dev server.`,
      buttons: ['Quit', 'Cancel'],
      cancelId: 1,
      choices: ['quit', null]
    }
  return {
    message: 'The window stopped working. Restart AI Maru?',
    detail: `${why} Restarting reopens the window and, when possible, reattaches to the running terminals.`,
    buttons: ['Restart', 'Quit'],
    cancelId: 1,
    choices: ['restart', 'quit']
  }
}
