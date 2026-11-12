/**
 * WindowServer 가 끝나 로그아웃된 뒤에도 살아남은 앱은 끊긴 세션에 남아 창을 잃는다. 그 앱이 띄운 자식(`app.relaunch()`,
 * `open`)도 그 세션을 물려받아 창을 띄우지 못하는 것으로 보인다. 그래서 새 세션에서 뜬 두 번째 인스턴스가 첫 인스턴스를
 * 끝내게 하고, 자기가 앱을 다시 띄운다. LaunchServices 가 아는 앱이면 다시 실행해도 두 번째 프로세스가 뜨지 않으므로, 두 번째
 * 인스턴스는 LaunchServices 에 없는 첫 인스턴스를 창을 잃은 것으로 본다.
 */
import { execFileSync } from 'node:child_process'
import { readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { processExists } from './pty'

export type TakeoverRequest = { takeover: true }

export const TAKEOVER_REQUEST: TakeoverRequest = { takeover: true }

/** Chromium 은 userData 의 `SingletonLock` 을 `<host>-<pid>` 를 가리키는 심볼릭 링크로 둔다. */
export function holderPid(target: string): number | null {
  const m = /-(\d+)$/.exec(target)
  return m ? Number(m[1]) : null
}

function lockHolder(userData: string): number | null {
  try {
    return holderPid(readlinkSync(join(userData, 'SingletonLock')))
  } catch {
    return null
  }
}

/**
 * `lsappinfo find pid=<pid>` 는 LaunchServices 가 아는 앱이면 `ASN:…` 줄을, 모르면 빈 줄을 내고 둘 다 exit 0 으로 끝난다.
 * 실행하지 못했거나 exit 이 0 이 아니면 판정하지 않는다(null).
 */
export function launchServicesKnows(pid: number, run: (args: string[]) => string): boolean | null {
  let out: string
  try {
    out = run(['find', `pid=${pid}`])
  } catch {
    return null
  }
  return /^ASN:/m.test(out)
}

/** 정상 앱의 pid 로 `lsappinfo find` 를 20번 돌려 9~21ms(중앙값 11ms) 걸렸다. */
const LSAPPINFO_TIMEOUT_MS = 1000

export type LostInstanceDeps = {
  platform: NodeJS.Platform
  userData: string
  self: number
  alive: (pid: number) => boolean
  run: (args: string[]) => string
}

export function lostInstance(deps: LostInstanceDeps): number | null {
  if (deps.platform !== 'darwin') return null
  const pid = lockHolder(deps.userData)
  if (pid === null || pid === deps.self || !deps.alive(pid)) return null
  return launchServicesKnows(pid, deps.run) === false ? pid : null
}

export function runLsappinfo(bin: string): (args: string[]) => string {
  return (args) => execFileSync(bin, args, { encoding: 'utf8', timeout: LSAPPINFO_TIMEOUT_MS })
}

function isTakeoverRequest(data: unknown): data is TakeoverRequest {
  return typeof data === 'object' && data !== null && (data as TakeoverRequest).takeover === true
}

export type SecondInstanceAction = 'hand-over' | 'ignore' | 'front'

/** 첫 인스턴스가 `second-instance` 를 받고 할 일이다. */
export function secondInstanceAction(
  data: unknown,
  ready: boolean,
  unobtrusive: boolean
): SecondInstanceAction {
  if (isTakeoverRequest(data)) return ready ? 'hand-over' : 'ignore'
  return unobtrusive ? 'ignore' : 'front'
}

export type TakeOverDeps = {
  gone: (pid: number) => Promise<boolean>
  relaunch: () => void
  quit: () => void
  log: (message: string) => void
}

/** 두 번째 인스턴스가 첫 인스턴스 `pid` 가 끝나기를 기다려 앱을 다시 띄운다. 끝나지 않으면 다시 띄우지 않고 끝낸다. */
export async function takeOver(pid: number, deps: TakeOverDeps): Promise<void> {
  deps.log(`maru: instance ${pid} has lost its connection to the window server; restarting it`)
  if (await deps.gone(pid)) {
    deps.relaunch()
    return
  }
  deps.log(`maru: instance ${pid} did not quit; quitting`)
  deps.quit()
}

const POLL_MS = 100

/**
 * `pid` 가 `limitMs` 안에 끝나면 true 다. 첫 인스턴스는 이 프로세스의 자식이 아니어서 `waitpid` 로 기다릴 수 없으므로, 살아
 * 있는지 되풀이해 본다.
 */
export async function waitGone(
  pid: number,
  limitMs: number,
  alive: (pid: number) => boolean = processExists,
  wait: (ms: number) => Promise<unknown> = sleep,
  now: () => number = Date.now
): Promise<boolean> {
  const until = now() + limitMs
  while (alive(pid)) {
    if (now() >= until) return false
    await wait(POLL_MS)
  }
  return true
}
