import { describe, expect, it } from 'vitest'
import type { PtyExit } from '../shared/pty'
import type { ListedJob } from '../shared/pty-list'
import type { ScreenState } from '../shared/screen'
import { InvalidParams } from './cli-server'
import { ptyCli } from './pty-cli'

const A = 'p-0000000a'
const B = 'p-0000000b'
const J = 'p-0000000f'

const SCREEN: ScreenState = {
  workspaces: [
    {
      key: 1,
      id: 'w-1',
      cells: [
        {
          key: 2,
          id: 'c-00000002',
          focused: 3,
          layout: { pane: 3 },
          panes: [{ key: 3, id: 'n-00000003', ptyId: A, cwd: '/r/a' }]
        }
      ]
    }
  ],
  selected: 2,
  folded: []
} as unknown as ScreenState

function setup({
  screen = SCREEN as ScreenState | null,
  jobs = [{ pty: J, name: 'dev', cell: 'c-00000002', command: ['pnpm', 'dev'] }] as ListedJob[],
  exits = new Map<string, PtyExit | null>(),
  capture = async (pty: string) => `screen of ${pty}`
} = {}) {
  const calls: string[] = []
  let exited = false
  const handlers = ptyCli({
    screen: () => screen,
    jobs: () => jobs,
    state: () => undefined,
    exit: async (pty) => exits.get(pty) ?? null,
    capture,
    paste: async (pty, text) => {
      calls.push(`paste ${pty} ${text}`)
      return exited ? 'exited' : 'written'
    },
    killJob: async (pty) => void calls.push(`killJob ${pty}`),
    closePty: async (pty) => void calls.push(`closePty ${pty}`),
    shell: '/bin/zsh',
    home: undefined
  })
  const run = (method: string, params: Record<string, unknown>) =>
    handlers[method](params, A) as Promise<unknown>
  return { run, calls, exit: () => (exited = true) }
}

describe('pty.list', () => {
  it('pane 의 pty 와 job 을 싣고, pane 의 pty 의 종료 상태를 묻는다', async () => {
    const { run } = setup({ exits: new Map([[A, { code: 1, signal: null }]]) })
    const { ptys } = (await run('pty.list', {})) as { ptys: object[] }
    expect(ptys).toEqual([
      expect.objectContaining({ pty: A, kind: 'pane', exit: { code: 1, signal: null } }),
      expect.objectContaining({ pty: J, kind: 'job', name: 'dev', exit: null })
    ])
  })

  it('창이 화면을 알리기 전이면 실패한다', async () => {
    const { run } = setup({ screen: null })
    await expect(run('pty.list', {})).rejects.toThrow('the window has not reported its layout yet')
  })
})

describe('pty.read·pty.send', () => {
  it('pane 의 pty 와 job 의 pty 를 읽고, 글자를 그대로 넘긴다', async () => {
    const { run, calls } = setup()
    for (const pty of [A, J]) {
      await expect(run('pty.read', { target: pty })).resolves.toEqual({ text: `screen of ${pty}` })
      await expect(run('pty.send', { target: pty, text: 'ls\r' })).resolves.toBeNull()
    }
    expect(calls).toEqual([`paste ${A} ls\r`, `paste ${J} ls\r`])
  })

  it('목록에 없는 pty 는 invalid_params 로 거절한다', async () => {
    const { run, calls } = setup()
    for (const method of ['pty.read', 'pty.send', 'pty.kill']) {
      await expect(run(method, { target: B, text: 'x' })).rejects.toThrow(
        new InvalidParams(`no pty ${B}`)
      )
    }
    expect(calls).toEqual([])
  })

  it('pty id 꼴이 아니거나 글자가 비면 params 오류다', async () => {
    const { run } = setup()
    for (const [method, params] of [
      ['pty.read', { target: 'n-00000003' }],
      ['pty.send', { target: 'x', text: 'a' }],
      ['pty.send', { target: A, text: '' }],
      ['pty.send', { target: A }],
      ['pty.kill', { target: 'dev' }]
    ] as const) {
      await expect(run(method, params)).rejects.toBeInstanceOf(InvalidParams)
    }
  })

  it('창이 화면을 알리기 전에도 job 의 pty 는 읽는다', async () => {
    const { run } = setup({ screen: null })
    await expect(run('pty.read', { target: J })).resolves.toEqual({ text: `screen of ${J}` })
    await expect(run('pty.read', { target: A })).rejects.toThrow(
      'the window has not reported its layout yet'
    )
  })

  it('셸이 끝난 pty 에 보내면 실패한다', async () => {
    const { run, exit } = setup()
    exit()
    await expect(run('pty.send', { target: A, text: 'x' })).rejects.toThrow(`pty ${A} has exited`)
  })

  it('pty 가 화면을 돌려주지 못하면 그 오류로 실패한다', async () => {
    const { run } = setup({
      capture: async (pty) => {
        throw new Error(`cannot read pty ${pty}: not_running`)
      }
    })
    await expect(run('pty.read', { target: A })).rejects.toThrow(
      `cannot read pty ${A}: not_running`
    )
  })
})

describe('pty.kill', () => {
  it('job 의 pty 면 job 으로, pane 의 pty 면 pane 을 닫아 끝낸다', async () => {
    const { run, calls } = setup()
    await expect(run('pty.kill', { target: J })).resolves.toBeNull()
    await expect(run('pty.kill', { target: A })).resolves.toBeNull()
    expect(calls).toEqual([`killJob ${J}`, `closePty ${A}`])
  })

  it('끝난 job 의 pty 도 job 으로 끝내 표에서 지운다', async () => {
    const { run, calls } = setup({
      jobs: [
        { pty: J, cell: 'c-00000002', command: ['sleep', '1'], exit: { code: 0, signal: null } }
      ]
    })
    await run('pty.kill', { target: J })
    expect(calls).toEqual([`killJob ${J}`])
  })
})
