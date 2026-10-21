import { describe, expect, it, vi } from 'vitest'
import { CliError, InvalidParams } from './cli-server'
import { createJobs, parseJobsFile, type JobDeps, type JobsFile } from './job'
import type { SessionExit } from './session'

const A = 's-0000000a'
const B = 's-0000000b'
const C = 's-0000000c'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function setup(workspaces: Record<string, string> = { [A]: 'w-1', [B]: 'w-1', [C]: 'w-2' }) {
  let n = 0
  const waits = new Map<string, { end: (e: SessionExit | null) => void; cancelled: boolean }>()
  const emitted: [string, object][] = []
  const listening = new Set<string>([A, B, C])
  const killed: string[] = []
  const spawns: { id: string; cwd: string; command: string[] }[] = []
  const deps = {
    newId: () => `s-${(++n).toString(16).padStart(8, '0')}`,
    workspaceOf: (s: string) => workspaces[s],
    spawn: vi.fn(async (id: string, cwd: string, command: string[]) => {
      spawns.push({ id, cwd, command })
    }),
    waitExit: (id: string) => {
      let end: (e: SessionExit | null) => void = () => {}
      const exit = new Promise<SessionExit | null>((r) => (end = r))
      const w = { end, cancelled: false }
      waits.set(id, w)
      return {
        exit,
        cancel: () => {
          w.cancelled = true
          end(null)
        }
      }
    },
    capture: vi.fn(async (id: string) => `out of ${id}`),
    input: vi.fn(async (): Promise<'written' | 'exited'> => 'written'),
    kill: vi.fn(async (id: string) => {
      killed.push(id)
    }),
    emit: (s: string, e: object) => {
      if (!listening.has(s)) return false
      emitted.push([s, e])
      return true
    }
  } satisfies JobDeps
  const jobs = createJobs(deps)
  const call = (method: string, params: Record<string, unknown>, session = A) =>
    Promise.resolve(jobs.handlers[method](params, session))
  const start = async (params: Record<string, unknown> = {}, session = A) =>
    (
      (await call('job.new', { cwd: '/w', command: ['sleep', '9'], ...params }, session)) as {
        session: string
      }
    ).session
  const list = async (session = A) =>
    ((await call('job.list', {}, session)) as { jobs: Record<string, unknown>[] }).jobs
  const exit = async (id: string, e: SessionExit | null) => {
    waits.get(id)!.end(e)
    await flush()
  }
  return { jobs, deps, call, start, list, exit, waits, emitted, listening, killed, spawns }
}

async function rejects(
  p: Promise<unknown>,
  cls: new (...args: never[]) => Error,
  reason?: string
): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(err).toBeInstanceOf(cls)
  if (reason) expect((err as CliError).reason).toBe(reason)
}

describe('job.new', () => {
  it('띄운 job 을 표에 넣고 그 session id 를 돌려준다', async () => {
    const t = setup()
    const id = await t.start({ name: 'dev', command: ['pnpm', 'dev'] })
    expect(id).toBe('s-00000001')
    expect(t.spawns).toEqual([{ id, cwd: '/w', command: ['pnpm', 'dev'] }])
    expect(await t.list()).toEqual([
      {
        session: id,
        name: 'dev',
        command: ['pnpm', 'dev'],
        state: 'running',
        code: null,
        signal: null
      }
    ])
  })

  it.each([
    [{ command: [] }],
    [{ command: 'ls' }],
    [{ command: ['ls', 1] }],
    [{ cwd: 'rel' }],
    [{ cwd: undefined }]
  ])('명령·디렉토리 모양이 틀리면 거절한다 (%j)', async (params) => {
    const t = setup()
    await rejects(t.start(params), InvalidParams)
  })

  it.each([['a'], ['dev.server_1'], ['x'.repeat(64)], ['A-1']])(
    '이름 %s 를 받는다',
    async (name) => {
      const t = setup()
      await t.start({ name })
    }
  )

  it.each([['-x'], ['.x'], ['한글'], ['x'.repeat(65)], ['s-1a2b3c4d'], [''], ['a b'], [7]])(
    '이름 %j 를 거절한다',
    async (name) => {
      const t = setup()
      await rejects(t.start({ name }), InvalidParams)
      expect(t.spawns).toEqual([])
    }
  )

  it('부른 세션이 workspace 에 없으면 거절한다', async () => {
    const t = setup()
    await rejects(t.start({}, 's-0000000f'), InvalidParams)
  })

  it('같은 workspace 에서 같은 이름이 돌고 있으면 거절하고, 다른 workspace 는 받는다', async () => {
    const t = setup()
    await t.start({ name: 'dev' })
    await rejects(t.start({ name: 'dev' }, B), CliError, 'job_name_taken')
    await t.start({ name: 'dev' }, C)
  })

  it('같은 이름의 끝난 job 은 끄고 갈아 끼운다', async () => {
    const t = setup()
    const old = await t.start({ name: 'build' })
    await t.exit(old, { code: 1, signal: null })
    const fresh = await t.start({ name: 'build' })
    expect(t.killed).toEqual([old])
    expect((await t.list()).map((j) => j.session)).toEqual([fresh])
  })

  it('동시에 온 같은 이름의 new 는 하나만 뜬다', async () => {
    const t = setup()
    let release = (): void => {}
    t.deps.spawn.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    const first = t.start({ name: 'dev' })
    await rejects(t.start({ name: 'dev' }, B), CliError, 'job_name_taken')
    release()
    await first
    expect(await t.list()).toHaveLength(1)
  })

  it('띄우지 못하면 표에 남지 않고 이름도 풀린다', async () => {
    const t = setup()
    t.deps.spawn.mockRejectedValueOnce(new Error('no session'))
    await expect(t.start({ name: 'dev' })).rejects.toThrow('no session')
    expect(await t.list()).toEqual([])
    await t.start({ name: 'dev' })
  })

  it('띄우는 동안 kill 하면 뜬 세션을 끈다', async () => {
    const t = setup()
    let release = (): void => {}
    t.deps.spawn.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    const started = t.start({ name: 'dev' })
    await flush()
    await t.call('job.kill', { target: 'dev' })
    release()
    await expect(started).rejects.toThrow()
    expect(t.killed).toEqual(['s-00000001', 's-00000001'])
    expect(await t.list()).toEqual([])
  })
})

describe('job.list', () => {
  it('부른 workspace 의 것만 띄운 순서로, 끝난 상태와 함께 보인다', async () => {
    const t = setup()
    const a = await t.start({ name: 'a' })
    await t.start({ name: 'other' }, C)
    const b = await t.start({}, B)
    await t.exit(a, { code: 1, signal: null })
    await t.exit(b, { code: null, signal: 9 })
    expect(await t.list()).toEqual([
      { session: a, name: 'a', command: ['sleep', '9'], state: 'exited', code: 1, signal: null },
      { session: b, command: ['sleep', '9'], state: 'exited', code: null, signal: 9 }
    ])
  })

  it('job 안에서 부르면 그 job 의 workspace 를 본다', async () => {
    const t = setup()
    const id = await t.start({ name: 'parent' }, C)
    expect((await t.list(id)).map((j) => j.name)).toEqual(['parent'])
    await t.start({ name: 'child' }, id)
    expect((await t.list(C)).map((j) => j.name)).toEqual(['parent', 'child'])
  })
})

describe('workspaceOf', () => {
  it('pane 세션은 그 pane 의, job 세션은 그 job 의 workspace 이고, 모르는 세션은 없다', async () => {
    const { jobs, start } = setup()
    const job = await start({}, C)
    expect(jobs.workspaceOf(A)).toBe('w-1')
    expect(jobs.workspaceOf(job)).toBe('w-2')
    expect(jobs.workspaceOf('s-000000ff')).toBeUndefined()
  })
})

describe('job.read·send·kill', () => {
  it('이름과 session id 로 찾고, 다른 workspace 의 job 은 없는 job 이다', async () => {
    const t = setup()
    const id = await t.start({ name: 'dev' })
    expect(await t.call('job.read', { target: 'dev' })).toEqual({ text: `out of ${id}` })
    expect(await t.call('job.read', { target: id }, B)).toEqual({ text: `out of ${id}` })
    await rejects(t.call('job.read', { target: 'dev' }, C), InvalidParams)
    await rejects(t.call('job.read', { target: id }, C), InvalidParams)
    await rejects(t.call('job.read', { target: 'nope' }), InvalidParams)
    await rejects(t.call('job.read', {}), InvalidParams)
  })

  it('send 는 받은 글자를 그대로 넘기고, 끝난 job 이면 job_exited', async () => {
    const t = setup()
    const id = await t.start({ name: 'dev' })
    expect(await t.call('job.send', { target: 'dev', text: 'r\r' })).toBeNull()
    expect(t.deps.input).toHaveBeenCalledWith(id, 'r\r')
    await rejects(t.call('job.send', { target: 'dev', text: 1 }), InvalidParams)
    t.deps.input.mockResolvedValueOnce('exited')
    await rejects(t.call('job.send', { target: 'dev', text: 'x' }), CliError, 'job_exited')
    await t.exit(id, { code: 0, signal: null })
    t.deps.input.mockClear()
    await rejects(t.call('job.send', { target: 'dev', text: 'x' }), CliError, 'job_exited')
    expect(t.deps.input).not.toHaveBeenCalled()
  })

  it('send 가 멈추면 그 실패를 그대로 돌려준다', async () => {
    const t = setup()
    await t.start({ name: 'dev' })
    t.deps.input.mockRejectedValueOnce(new Error('did not answer within 8s'))
    await expect(t.call('job.send', { target: 'dev', text: 'x' })).rejects.toThrow('8s')
  })

  it('kill 은 끄고 목록에서 지우며, 뒤늦은 종료를 알리지 않는다', async () => {
    const t = setup()
    const id = await t.start({ name: 'dev' })
    await t.call('job.kill', { target: 'dev' })
    expect(t.killed).toEqual([id])
    expect(await t.list()).toEqual([])
    expect(t.waits.get(id)!.cancelled).toBe(true)
    await flush()
    expect(t.emitted).toEqual([])
  })

  it('kill 이 끝날 때까지 목록에 남아, 그 사이 같은 이름의 new 를 거절한다', async () => {
    const t = setup()
    await t.start({ name: 'dev' })
    let release = (): void => {}
    t.deps.kill.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    const killing = t.call('job.kill', { target: 'dev' })
    await flush()
    expect(await t.list()).toHaveLength(1)
    await rejects(t.start({ name: 'dev' }), CliError, 'job_name_taken')
    release()
    await killing
    expect(await t.list()).toEqual([])
  })

  it('끝난 job 의 kill 은 지우기만 한다', async () => {
    const t = setup()
    const id = await t.start({ name: 'dev' })
    await t.exit(id, { code: 0, signal: null })
    await t.call('job.kill', { target: id })
    expect(await t.list()).toEqual([])
  })
})

describe('알림', () => {
  it('스스로 끝나면 띄운 세션에 알린다. 이름이 없으면 name 키가 없다', async () => {
    const t = setup()
    const named = await t.start({ name: 'build' })
    const bare = await t.start({}, B)
    await t.exit(named, { code: 1, signal: null })
    await t.exit(bare, { code: null, signal: 9 })
    expect(t.emitted).toEqual([
      [A, { event: 'job', session: named, name: 'build', code: 1, signal: null }],
      [B, { event: 'job', session: bare, code: null, signal: 9 }]
    ])
  })

  it('구독이 없으면 붙여 두었다가 띄운 세션이 구독할 때 한 번 보낸다', async () => {
    const t = setup()
    t.listening.clear()
    const id = await t.start({ name: 'build' })
    await t.exit(id, { code: 2, signal: null })
    expect(t.emitted).toEqual([])
    t.listening.add(A)
    t.listening.add(B)
    t.jobs.subscribed(B)
    expect(t.emitted).toEqual([])
    t.jobs.subscribed(A)
    t.jobs.subscribed(A)
    expect(t.emitted).toEqual([
      [A, { event: 'job', session: id, name: 'build', code: 2, signal: null }]
    ])
  })

  it('답 없이 닫힌 wait 는 job 을 지우고 알리지 않는다', async () => {
    const t = setup()
    const id = await t.start({ name: 'dev' })
    await t.exit(id, null)
    expect(await t.list()).toEqual([])
    expect(t.emitted).toEqual([])
  })
})

describe('closeWorkspace', () => {
  it('띄우는 중인 job 도 뜬 뒤에 끈다', async () => {
    const t = setup()
    let release = (): void => {}
    t.deps.spawn.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    const started = t.start({ name: 'dev' })
    await flush()
    await t.jobs.closeWorkspace('w-1')
    release()
    await expect(started).rejects.toThrow()
    expect(t.killed).toEqual(['s-00000001', 's-00000001'])
  })

  it('그 workspace 의 job 만 끄고 알리지 않는다', async () => {
    const t = setup()
    const a = await t.start({ name: 'a' })
    const c = await t.start({ name: 'c' }, C)
    await t.jobs.closeWorkspace('w-1')
    expect(t.killed).toEqual([a])
    expect(await t.list(C)).toHaveLength(1)
    await flush()
    expect(t.emitted).toEqual([])
    expect((await t.list(C)).map((j) => j.session)).toEqual([c])
  })
})

describe('재시작', () => {
  it('save 는 wait 를 모두 닫고 표를 돌려주며, 그 뒤의 종료는 알리지 않는다', async () => {
    const t = setup()
    const run = await t.start({ name: 'run' })
    const done = await t.start({ name: 'done' })
    t.listening.clear()
    await t.exit(done, { code: 0, signal: null })
    const file = t.jobs.save()
    expect(t.waits.get(run)!.cancelled).toBe(true)
    expect(file).toEqual({
      version: 1,
      jobs: [
        {
          session: run,
          name: 'run',
          workspace: 'w-1',
          owner: A,
          command: ['sleep', '9'],
          pending: false
        },
        {
          session: done,
          name: 'done',
          workspace: 'w-1',
          owner: A,
          command: ['sleep', '9'],
          exit: { code: 0, signal: null },
          pending: true
        }
      ]
    })
    await flush()
    expect(await t.list()).toHaveLength(2)
  })

  it('save 한 뒤에 뜬 job 은 wait 를 걸지 않는다', async () => {
    const t = setup()
    let release = (): void => {}
    t.deps.spawn.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    const started = t.start({ name: 'late' })
    await flush()
    t.jobs.save()
    release()
    const id = await started
    expect(t.waits.has(id)).toBe(false)
    t.jobs.resume()
    expect(t.waits.has(id)).toBe(true)
  })

  it('resume 은 끝나지 않은 job 의 wait 를 다시 건다', async () => {
    const t = setup()
    const id = await t.start({ name: 'run' })
    t.jobs.save()
    t.jobs.resume()
    expect(t.waits.get(id)!.cancelled).toBe(false)
    await t.exit(id, { code: 3, signal: null })
    expect(t.emitted).toHaveLength(1)
  })

  it('restore 는 끝나지 않은 job 에만 wait 를 걸고, 붙여 둔 알림만 보낸다', async () => {
    const t = setup()
    const file: JobsFile = {
      version: 1,
      jobs: [
        { session: 's-000000a1', workspace: 'w-1', owner: A, command: ['a'], pending: false },
        {
          session: 's-000000a2',
          workspace: 'w-1',
          owner: A,
          command: ['b'],
          exit: { code: 1, signal: null },
          pending: true
        },
        {
          session: 's-000000a3',
          workspace: 'w-1',
          owner: A,
          command: ['c'],
          exit: { code: 0, signal: null },
          pending: false
        }
      ]
    }
    t.jobs.restore(file)
    expect([...t.waits.keys()]).toEqual(['s-000000a1'])
    expect((await t.list()).map((j) => j.session)).toEqual([
      's-000000a1',
      's-000000a2',
      's-000000a3'
    ])
    t.jobs.subscribed(A)
    expect(t.emitted).toEqual([[A, { event: 'job', session: 's-000000a2', code: 1, signal: null }]])
    await t.exit('s-000000a1', { code: 7, signal: null })
    expect(t.emitted).toHaveLength(2)
  })
})

describe('parseJobsFile', () => {
  it('모양이 맞는 파일만 받는다', () => {
    const job = { session: A, workspace: 'w-1', owner: B, command: ['x'], pending: false }
    expect(parseJobsFile({ version: 1, jobs: [job] })).toEqual({ version: 1, jobs: [job] })
    expect(parseJobsFile({ version: 2, jobs: [job] })).toBeNull()
    expect(parseJobsFile({ version: 1, jobs: [{ ...job, session: 'x' }] })).toBeNull()
    expect(parseJobsFile({ version: 1, jobs: [{ ...job, command: [] }] })).toBeNull()
    expect(parseJobsFile({ version: 1, jobs: [{ ...job, exit: { code: 'x' } }] })).toBeNull()
    expect(parseJobsFile(null)).toBeNull()
  })
})
