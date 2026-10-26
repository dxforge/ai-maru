import {
  CliError,
  InvalidParams,
  isCommand,
  requireCommand,
  requireCwd,
  type Handlers
} from './cli-server'
import type { PtyExit } from './pty'
import { isPtyId } from '../shared/pty'

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** pty 의 답을 기다리는 상한. `maru` 의 `TIMEOUT`(main.rs)이 10초이므로 시간 초과 오류가 그 안에 닿게 한다. */
export const JOB_REPLY_MS = 8_000

/** `owner` 는 `job.new` 를 부른 pty 다. `pending` 은 끝났지만 아직 `owner` 에 알리지 못했다는 표시다. */
export type JobRecord = {
  pty: string
  name?: string
  cell: string
  owner: string
  command: string[]
  exit?: PtyExit
  pending: boolean
}

/** 재시작 전 앱이 쓰고 다시 뜬 앱이 읽는다. 모양을 바꾸면 버전을 올린다. */
export type JobsFile = { version: 3; jobs: JobRecord[] }

export type JobDeps = {
  newId: () => string
  cellOf: (pty: string) => string | undefined
  /** `maru-pty --keep` 으로 띄운다. 소켓이 열린 뒤에 끝난다. */
  spawn: (id: string, cwd: string, command: string[]) => Promise<void>
  waitExit: (id: string) => { exit: Promise<PtyExit | null>; cancel: () => void }
  capture: (id: string) => Promise<string>
  input: (id: string, text: string) => Promise<'written' | 'exited'>
  kill: (id: string) => Promise<void>
  emit: (pty: string, event: object) => boolean
}

/** 계약은 `main.rs`(`core/crates/maru/src/main.rs`)의 모듈 doc 에 있다. 표는 띄운 순서다. */
export function createJobs(deps: JobDeps) {
  const jobs: JobRecord[] = []
  const waits = new Map<string, () => void>()
  let saved = false

  function cellOf(pty: string): string | undefined {
    return deps.cellOf(pty) ?? jobs.find((j) => j.pty === pty)?.cell
  }

  function callerCell(pty: string): string {
    const c = cellOf(pty)
    if (c === undefined) throw new InvalidParams(`pty ${pty} is not in a cell`)
    return c
  }

  function find(cell: string, target: unknown): JobRecord {
    if (typeof target !== 'string' || target === '') {
      throw new InvalidParams('params.target must be a job name or pty id')
    }
    const key = isPtyId(target) ? 'pty' : 'name'
    const job = jobs.find((j) => j.cell === cell && j[key] === target)
    if (!job) throw new InvalidParams(`no job ${target} in this cell`)
    return job
  }

  function stopWaiting(pty: string): void {
    const cancel = waits.get(pty)
    waits.delete(pty)
    cancel?.()
  }

  function remove(job: JobRecord): void {
    const i = jobs.indexOf(job)
    if (i !== -1) jobs.splice(i, 1)
    stopWaiting(job.pty)
  }

  function notify(job: JobRecord): void {
    const { pty, name, exit } = job
    const event = { event: 'job', pty, ...(name !== undefined && { name }), ...exit }
    job.pending = !deps.emit(job.owner, event)
  }

  function watch(job: JobRecord): void {
    const { exit, cancel } = deps.waitExit(job.pty)
    waits.set(job.pty, cancel)
    void exit.then((e) => {
      // `stopWaiting` 이 닫은 wait 는 null 로 끝나므로 버린다.
      if (waits.get(job.pty) !== cancel) return
      waits.delete(job.pty)
      // pty 가 셸을 끝냈거나 사라졌다. 스스로 끝난 것이 아니므로 알리지 않는다.
      if (!e) return remove(job)
      job.exit = { code: e.code, signal: e.signal }
      notify(job)
    })
  }

  function view(j: JobRecord): object {
    return {
      pty: j.pty,
      ...(j.name !== undefined && { name: j.name }),
      command: j.command,
      state: j.exit ? 'exited' : 'running',
      code: j.exit?.code ?? null,
      signal: j.exit?.signal ?? null
    }
  }

  const handlers: Handlers = {
    'job.new': async (params, pty) => {
      const command = requireCommand(params.command)
      const cwd = requireCwd(params.cwd)
      const { name } = params
      if (name !== undefined && (typeof name !== 'string' || !NAME.test(name) || isPtyId(name))) {
        throw new InvalidParams(
          'params.name must be 1-64 letters, digits, ".", "_" or "-", start with a letter or digit, and not look like a pty id'
        )
      }
      const cell = callerCell(pty)
      const same =
        name === undefined ? undefined : jobs.find((j) => j.cell === cell && j.name === name)
      if (same && !same.exit) {
        throw new CliError(-32001, 'job_name_taken', `job ${name} is running in this cell`)
      }
      const job: JobRecord = {
        pty: deps.newId(),
        ...(name !== undefined && { name }),
        cell,
        owner: pty,
        command,
        pending: false
      }
      // 기다리기 전에 표에 넣어 이름을 잡는다 — 동시에 온 같은 이름의 new 가 둘 다 지나가지 않게.
      if (same) remove(same)
      jobs.push(job)
      try {
        if (same) await deps.kill(same.pty)
        await deps.spawn(job.pty, cwd, command)
      } catch (err) {
        remove(job)
        throw err
      }
      // 띄우는 동안 kill·cell 닫기가 지웠으면, 그때는 소켓이 없어 끄지 못했다.
      if (!jobs.includes(job)) {
        await deps.kill(job.pty)
        throw new Error(`job ${name ?? job.pty} was killed while it started`)
      }
      // `save` 가 표를 넘긴 뒤면 다시 뜬 앱이 이 job 을 기다리므로, 여기서도 기다리면 두 번 알릴 수 있다.
      if (!saved) watch(job)
      return { pty: job.pty }
    },
    'job.list': (_params, pty) => {
      const cell = callerCell(pty)
      return { jobs: jobs.filter((j) => j.cell === cell).map(view) }
    },
    'job.read': async ({ target }, pty) => {
      const job = find(callerCell(pty), target)
      return { text: await deps.capture(job.pty) }
    },
    'job.send': async ({ target, text }, pty) => {
      const job = find(callerCell(pty), target)
      if (typeof text !== 'string') throw new InvalidParams('params.text must be a string')
      const exited = (): CliError =>
        new CliError(-32001, 'job_exited', `job ${String(target)} has exited`)
      if (job.exit) throw exited()
      if ((await deps.input(job.pty, text)) === 'exited') throw exited()
      return null
    },
    'job.kill': async ({ target }, pty) => {
      const job = find(callerCell(pty), target)
      // 끝날 때까지 목록에 두어, 그 사이 같은 이름의 new 가 아직 도는 프로세스 옆에 뜨지 않게 한다.
      stopWaiting(job.pty)
      await deps.kill(job.pty)
      remove(job)
      return null
    }
  }

  return {
    handlers,
    cellOf,
    subscribed: (pty: string): void => {
      for (const j of jobs) if (j.owner === pty && j.pending) notify(j)
    },
    running: (cells?: ReadonlySet<string>): number =>
      jobs.filter((j) => !j.exit && (!cells || cells.has(j.cell))).length,
    closeCell: async (cell: string): Promise<void> => {
      const closing = jobs.filter((j) => j.cell === cell)
      for (const j of closing) remove(j)
      await Promise.all(closing.map((j) => deps.kill(j.pty)))
    },
    /** wait 를 먼저 닫는다 — 쓴 뒤에 끝난 job 은 다시 뜬 앱의 wait 가 받아 한 번만 알린다. */
    save: (): JobsFile => {
      saved = true
      for (const pty of [...waits.keys()]) stopWaiting(pty)
      return structuredClone({ version: 3, jobs })
    },
    resume: (): void => {
      saved = false
      for (const j of jobs) if (!j.exit && !waits.has(j.pty)) watch(j)
    },
    restore: (file: JobsFile): void => {
      jobs.push(...file.jobs)
      for (const j of file.jobs) if (!j.exit) watch(j)
    }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isCode = (v: unknown): boolean => v === null || Number.isInteger(v)

function isJob(v: unknown): v is JobRecord {
  return (
    isObj(v) &&
    isPtyId(v.pty) &&
    (v.name === undefined || typeof v.name === 'string') &&
    typeof v.cell === 'string' &&
    isPtyId(v.owner) &&
    isCommand(v.command) &&
    (v.exit === undefined || (isObj(v.exit) && isCode(v.exit.code) && isCode(v.exit.signal))) &&
    typeof v.pending === 'boolean'
  )
}

export function parseJobsFile(v: unknown): JobsFile | null {
  if (!isObj(v) || v.version !== 3 || !Array.isArray(v.jobs) || !v.jobs.every(isJob)) return null
  return v as JobsFile
}
