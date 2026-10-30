import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { STATE_VERSIONS } from '../shared/screen'
import type { Dialog } from './close-confirm'
import { livePtys } from './pty'

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
  /** 다시 뜬 앱이 할 수 있는 복원 — `layout` 이면 레이아웃만, `empty` 면 빈 화면이다. */
  result: 'layout' | 'empty'
  ptys: number
  /** 설치된 `maru-pty` 의 프로토콜이 다르고 살아 있는 pty 가 있을 때만 있다. 버전을 알 수 없으면 null 이다. */
  protocol?: number | null
  formats: ('layout' | 'sessions')[]
  /** 설치된 번들에 형식 버전 파일이 없거나 읽지 못해, `formats` 를 모두 다른 것으로 보았다. */
  formatsUnknown?: true
}

export type RestartCheck = { ok: true } | { ok: false; reason: 'dev_server' } | Incompatible

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
  const formats = (['layout', 'sessions'] as const).filter(
    (k) => versions?.[k] !== STATE_VERSIONS[k]
  )
  const protocolDiffers = protocol !== PROTOCOL_VERSION && live.length > 0
  if (!formats.length && !protocolDiffers) return { ok: true }
  return {
    ok: false,
    reason: 'incompatible',
    result: formats.includes('layout') ? 'empty' : 'layout',
    ptys: live.length,
    ...(protocolDiffers && { protocol }),
    formats,
    ...(!versions && { formatsUnknown: true as const })
  }
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
    const saved = check.formats.map((f) => (f === 'layout' ? 'layout' : 'terminal sessions'))
    parts.push(`The installed app uses a different format for the saved ${saved.join(' and ')}.`)
  }
  return parts
}

function restartDetail(check: Incompatible): string {
  const ending =
    check.ptys === 0
      ? []
      : [`This will end ${check.ptys} ${check.ptys === 1 ? 'terminal' : 'terminals'}.`]
  const after =
    check.result === 'layout'
      ? 'The panes will reopen with new shells in their last directories.'
      : 'The app will start with an empty screen.'
  return [...reasons(check), ...ending, after].join(' ')
}

export function restartDialog(check: Incompatible): Dialog {
  const action =
    check.result === 'layout' ? 'Restart with layout only' : 'Restart with an empty screen'
  return { message: `${action}?`, detail: restartDetail(check), buttons: [action, 'Cancel'] }
}

export function restartRefusal(check: Incompatible): string {
  const result = check.result === 'layout' ? 'with the layout only' : 'with an empty screen'
  return `${restartDetail(check)} Pass --kill-ptys to restart ${result}.`
}
