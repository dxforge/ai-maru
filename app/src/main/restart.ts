import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { STATE_VERSIONS } from '../shared/screen'
import type { Dialog } from './close-confirm'
import { liveRecords } from './pty'
import { inProtocolRange } from './pty-protocol'
import type { Outcome, TableName } from './state'

const run = promisify(execFile)

async function printed(bin: string, flag: string): Promise<number | null> {
  try {
    const { stdout } = await run(bin, [flag])
    const v = stdout.trim()
    return /^\d+$/.test(v) ? Number(v) : null
  } catch {
    return null
  }
}

/**
 * `bin` 이 받는 프로토콜 버전의 범위다. 버전을 알 수 없으면 null 이다. `--min-protocol-version` 을 모르는 빌드는 자기
 * 버전만 받으므로 하한을 그 버전으로 본다.
 */
export async function ptyProtocolRange(bin: string): Promise<{ min: number; max: number } | null> {
  const [max, min] = await Promise.all([
    printed(bin, '--protocol-version'),
    printed(bin, '--min-protocol-version')
  ])
  if (max === null) return null
  return { min: min !== null && min <= max ? min : max, max }
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
  /**
   * 설치된 앱이 붙지 못하는 살아 있는 pty 가 있을 때만 있다. 그 pty 들의 버전을 중복 없이 오름차순으로 담고, 정수가
   * 아닌 버전은 빼므로 비어 있을 수 있다. 설치된 앱의 버전을 알 수 없으면 null 이다.
   */
  protocol?: number[] | null
  /** 설치된 앱이 붙을 수 있어 끄지 않고 남길 살아 있는 pty 다. `protocol` 이 있을 때만 있다. */
  kept?: string[]
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
 * 앱은 레코드 버전이 그 `maru-pty` 가 받는 범위 밖인 pty 에 붙지 못하고, 버전이 다른 표를 버린다. `view` 의 버전이
 * 달라도 보기 설정만 잃으므로 묻지 않는다.
 */
export async function checkRestart(o: {
  devServer: boolean
  bin: string
  versionsFile: string
  dir: string
}): Promise<RestartCheck> {
  if (o.devServer) return { ok: false, reason: 'dev_server' }
  const [range, versions, live] = await Promise.all([
    ptyProtocolRange(o.bin),
    installedVersions(o.versionsFile),
    liveRecords(o.dir)
  ])
  const formats = FORMATS.filter((k) => versions?.[k] !== STATE_VERSIONS[k])
  const inRange = (v: unknown): boolean => range !== null && inProtocolRange(v, range)
  const ending = live.filter((r) => !inRange(r.protocol_version))
  const kept = live.filter((r) => inRange(r.protocol_version)).map((r) => r.id)
  const protocolDiffers = ending.length > 0
  if (!formats.length && !protocolDiffers) return { ok: true }
  const result = restartResult(formats, protocolDiffers)
  const protocol =
    range === null
      ? null
      : [...new Set(ending.map((r) => r.protocol_version).filter(Number.isInteger))].sort(
          (a, b) => a - b
        )
  return {
    ok: false,
    reason: 'incompatible',
    result,
    ptys: ending.length,
    recovered: result === 'full' ? 0 : kept.length,
    ...(protocolDiffers && { protocol, kept }),
    formats,
    ...(!versions && { formatsUnknown: true as const })
  }
}

/**
 * 형식이 다른 표는 결과와 상관없이 비운다. 남기면 다시 뜬 앱이 읽지 못한 표를 toast 로 알려, 사용자가 이미 고른 손실을
 * 다시 알리기 때문이다. 다시 뜬 앱이 붙을 수 있는 pty 는 남긴다(`keep`). 다시 뜬 앱이 붙을 pane 이 없는 pty 를
 * `Recovered` workspace 로 열기 때문이다. `outcome` 이 `keep` 이 아니면 끝낼 때 `keep` 의 pty 만 남긴다.
 */
export function restartOutcome(check: RestartCheck): {
  outcome: Outcome
  drop: TableName[]
  keep: string[]
} {
  if (check.ok) return { outcome: 'keep', drop: [], keep: [] }
  if (check.reason !== 'incompatible') return { outcome: 'layout', drop: [], keep: [] }
  if (check.protocol === undefined) return { outcome: 'keep', drop: check.formats, keep: [] }
  return {
    outcome: check.result === 'empty' ? 'end' : 'layout',
    drop: check.formats,
    keep: check.kept ?? []
  }
}

const formatName = (f: TableName): string => (f === 'sessions' ? 'terminal sessions' : f)

function joined(items: (string | number)[]): string {
  const rest = items.map(String)
  const last = rest.pop()
  return rest.length ? `${rest.join(', ')} and ${last}` : (last ?? '')
}

function reasons(check: Incompatible): string[] {
  const parts: string[] = []
  if (check.protocol === null)
    parts.push(
      `The installed app's pty protocol version couldn't be determined (this app uses version ${PROTOCOL_VERSION}).`
    )
  else if (check.protocol?.length)
    parts.push(
      `The installed app can't reattach to terminals that use pty protocol ${check.protocol.length === 1 ? 'version' : 'versions'} ${joined(check.protocol)}.`
    )
  else if (check.protocol)
    parts.push(
      "The installed app can't reattach to terminals whose pty protocol version is unknown."
    )
  if (check.formatsUnknown)
    parts.push("The installed app's saved-state format couldn't be determined.")
  else if (check.formats.length)
    parts.push(
      `The installed app uses a different saved-state format for the ${joined(check.formats.map(formatName))}.`
    )
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
        'Workspaces will lose their custom names, favorites and Keep Workspace. Workspaces without cells will be removed.'
      ]
    : []
  return [...reasons(check), ...ending, ...after, ...moving, ...workspaces].join(' ')
}

export function restartDialog(check: Incompatible): Dialog {
  const action = {
    full: 'Restart and lose workspace details',
    layout: 'Restart with layout only',
    cells: 'Restart with one shell per cell',
    empty: 'Restart and close all cells'
  }[check.result]
  return { message: `${action}?`, detail: restartDetail(check), buttons: [action, 'Cancel'] }
}

export function restartRefusal(check: Incompatible): {
  code: 'workspace_details_would_be_lost' | 'layout_would_be_lost' | 'ptys_would_end'
  message: string
} {
  const result = {
    full: 'and lose workspace details',
    layout: 'with the layout only',
    cells: 'with one shell per cell',
    empty: 'and close all cells'
  }[check.result]
  return {
    code:
      check.protocol !== undefined
        ? 'ptys_would_end'
        : check.result === 'full'
          ? 'workspace_details_would_be_lost'
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
