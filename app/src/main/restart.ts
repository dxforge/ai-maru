import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { STATE_VERSIONS } from '../shared/screen'
import type { Dialog } from './close-confirm'
import { liveRecords } from './pty'
import type { Outcome, TableName } from './state'

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
   * 다시 뜬 앱이 할 수 있는 복원 — `full` 이면 pty 에 다시 붙지만 `workspaces` 표를 잃고, `layout` 이면 배치만,
   * `cells` 면 cell 마다 셸 하나로, `empty` 면 cell 을 모두 닫는다.
   */
  result: 'full' | 'layout' | 'cells' | 'empty'
  /** 꺼질 pty 수다. */
  ptys: number
  /** 다시 뜬 앱이 붙을 pane 을 찾지 못해 `Recovered` workspace 로 옮길 pty 수다. */
  recovered: number
  /** 설치된 `maru-pty` 의 프로토콜이 다르고 살아 있는 pty 가 있을 때만 있다. 버전을 알 수 없으면 null 이다. */
  protocol?: number | null
  formats: TableName[]
  /** 설치된 번들에 형식 버전 파일이 없거나 읽지 못해, `formats` 를 모두 다른 것으로 보았다. */
  formatsUnknown?: true
}

export type RestartCheck = { ok: true } | { ok: false; reason: 'dev_server' } | Incompatible

const FORMATS: TableName[] = ['workspaces', 'cells', 'panes', 'sessions']

function restartResult(formats: TableName[], protocolDiffers: boolean): Incompatible['result'] {
  if (formats.includes('cells')) return 'empty'
  if (formats.includes('panes')) return 'cells'
  return protocolDiffers || formats.includes('sessions') ? 'layout' : 'full'
}

/**
 * `bin`·`versionsFile` 은 다음에 뜰 앱의 것이다 — `scripts/install-app.sh` 는 같은 경로의 번들을 갈아 끼운다. 다시 뜬
 * 앱은 프로토콜이 다른 pty 에 붙지 못하고, 버전이 다른 표를 버린다. `view` 의 버전이 달라도 보기 설정만 잃으므로
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
    liveRecords(o.dir)
  ])
  const formats = FORMATS.filter((k) => versions?.[k] !== STATE_VERSIONS[k])
  const protocolDiffers = protocol !== PROTOCOL_VERSION && live.length > 0
  if (!formats.length && !protocolDiffers) return { ok: true }
  const result = restartResult(formats, protocolDiffers)
  return {
    ok: false,
    reason: 'incompatible',
    result,
    ptys: protocolDiffers ? live.length : 0,
    recovered: protocolDiffers || result === 'full' ? 0 : live.length,
    ...(protocolDiffers && { protocol }),
    formats,
    ...(!versions && { formatsUnknown: true as const })
  }
}

/**
 * 형식이 다른 표는 결과와 상관없이 비운다. 남기면 다시 뜬 앱이 읽지 못한 표를 toast 로 알려, 사용자가 이미 고른 손실을
 * 다시 알리기 때문이다. 프로토콜이 같으면 pty 를 남긴다. 다시 뜬 앱이 붙을 pane 이 없는 pty 를 `Recovered` workspace
 * 로 열기 때문이다.
 */
export function restartOutcome(check: RestartCheck): { outcome: Outcome; drop: TableName[] } {
  if (check.ok) return { outcome: 'keep', drop: [] }
  if (check.reason !== 'incompatible') return { outcome: 'layout', drop: [] }
  const outcome =
    check.protocol === undefined ? 'keep' : check.result === 'empty' ? 'end' : 'layout'
  return { outcome, drop: check.formats }
}

const formatName = (f: TableName): string => (f === 'sessions' ? 'terminal sessions' : f)

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
    const saved = check.formats.map((f) => formatName(f))
    const last = saved.pop()
    const list = saved.length ? `${saved.join(', ')} and ${last}` : last
    parts.push(`The installed app uses a different saved-state format for the ${list}.`)
  }
  return parts
}

const terminals = (n: number): string => `${n} ${n === 1 ? 'terminal' : 'terminals'}`

function restartDetail(check: Incompatible): string {
  const ending = check.ptys === 0 ? [] : [`This will end ${terminals(check.ptys)}.`]
  const moving =
    check.recovered === 0
      ? []
      : [`${terminals(check.recovered)} will keep running in a new workspace named Recovered.`]
  const after = {
    full: [],
    layout: ['The panes will reopen with new shells in their last directories.'],
    cells: ['Each cell will reopen with one new shell.'],
    empty: ['All cells will close.']
  }[check.result]
  const workspaces = check.formats.includes('workspaces')
    ? [
        'Workspaces will be unpinned and lose their custom names and favorites. Workspaces without cells will be removed.'
      ]
    : []
  return [...reasons(check), ...ending, ...after, ...moving, ...workspaces].join(' ')
}

export function restartDialog(check: Incompatible): Dialog {
  const action = {
    full: 'Restart without workspace pins',
    layout: 'Restart with layout only',
    cells: 'Restart with one shell per cell',
    empty: 'Restart and close all cells'
  }[check.result]
  return { message: `${action}?`, detail: restartDetail(check), buttons: [action, 'Cancel'] }
}

export function restartRefusal(check: Incompatible): {
  code: 'pins_would_be_lost' | 'layout_would_be_lost' | 'ptys_would_end'
  message: string
} {
  const result = {
    full: 'without workspace pins',
    layout: 'with the layout only',
    cells: 'with one shell per cell',
    empty: 'and close all cells'
  }[check.result]
  return {
    code:
      check.protocol !== undefined
        ? 'ptys_would_end'
        : check.result === 'full'
          ? 'pins_would_be_lost'
          : 'layout_would_be_lost',
    message: `${restartDetail(check)} Pass --kill-ptys to restart ${result}.`
  }
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
