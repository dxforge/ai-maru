import { describe, expect, it, vi } from 'vitest'
import type { ProgramStatusRecord, ProgramStatusState } from '../shared/program-status'
import { createSeen, idleArgs } from './seen'

function record(id: string, state: ProgramStatusState, over: Partial<ProgramStatusRecord> = {}) {
  return { id, state, kind: null, progress: null, app: '', title: '', message: '', ...over }
}

describe('idleArgs', () => {
  it('루트 레코드는 --id 없이, app·title·message 를 그대로 넘긴다', () => {
    expect(
      idleArgs('p-1', record('', 'done', { app: 'claude-code', title: 'T', message: '-m x' }))
    ).toEqual([
      'status',
      'put',
      'idle',
      '--pty',
      'p-1',
      '--app',
      'claude-code',
      '--title',
      'T',
      '--msg',
      '-m x'
    ])
  })

  it('하위 레코드는 --id 를 넘기고, 빈 app·title·message 는 옵션을 뺀다', () => {
    expect(idleArgs('p-1', record('build/test', 'done'))).toEqual([
      'status',
      'put',
      'idle',
      '--pty',
      'p-1',
      '--id',
      'build/test'
    ])
  })
})

describe('createSeen', () => {
  function setup(records: ProgramStatusRecord[]) {
    const runs: string[][] = []
    const run = vi.fn(async (args: string[]) => void runs.push(args))
    const seen = createSeen({ records: (pty) => (pty === 'p-1' ? records : []), run })
    return { seen, runs, run }
  }

  it('done 레코드만 하나씩 idle 로 쓰고, blocked·error·working·idle 은 건너뛴다', async () => {
    const { seen, runs } = setup([
      record('', 'done', { app: 'claude-code' }),
      record('ask', 'blocked'),
      record('build', 'done'),
      record('fail', 'error'),
      record('job', 'working'),
      record('rest', 'idle')
    ])
    await seen('p-1')
    expect(runs).toEqual([
      ['status', 'put', 'idle', '--pty', 'p-1', '--app', 'claude-code'],
      ['status', 'put', 'idle', '--pty', 'p-1', '--id', 'build']
    ])
  })

  it('done 레코드가 없거나 모르는 pty 면 실행하지 않는다', async () => {
    const { seen, run } = setup([record('', 'blocked')])
    await seen('p-1')
    await seen('p-2')
    expect(run).not.toHaveBeenCalled()
  })

  it('한 레코드의 실행이 실패해도 다음 레코드를 쓴다', async () => {
    const records = [record('a', 'done'), record('b', 'done')]
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runs: string[][] = []
    const seen = createSeen({
      records: () => records,
      run: async (args) => {
        runs.push(args)
        if (args.includes('a')) throw new Error('boom')
      }
    })
    await seen('p-1')
    expect(runs.map((a) => a[6])).toEqual(['a', 'b'])
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('레코드를 넘기면 든 레코드 대신 그것만 본다', async () => {
    const { seen, runs } = setup([record('a', 'done'), record('b', 'done')])
    await seen('p-1', [record('b', 'done')])
    expect(runs).toEqual([['status', 'put', 'idle', '--pty', 'p-1', '--id', 'b']])
  })
})
