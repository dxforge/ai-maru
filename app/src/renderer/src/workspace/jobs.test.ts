import { describe, expect, it } from 'vitest'
import type { JobView } from '../../../shared/job'
import { syncJobs } from './jobs'

const job = (pty: string): JobView => ({ pty, cell: 'c-1', command: ['x'], ports: [] })

function fake() {
  let push: (jobs: JobView[]) => void = () => {}
  let answer: (jobs: JobView[]) => void = () => {}
  const seen: string[][] = []
  syncJobs((jobs) => seen.push(jobs.map((j) => j.pty)), {
    onJobs: (cb) => (push = cb),
    jobs: () => new Promise((r) => (answer = r))
  })
  return { push: (j: JobView[]) => push(j), answer: (j: JobView[]) => answer(j), seen }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('syncJobs', () => {
  it('처음 받은 전체를 넣고, 그 뒤 push 를 넣는다', async () => {
    const t = fake()
    t.answer([job('p-00000001')])
    await flush()
    t.push([])
    expect(t.seen).toEqual([['p-00000001'], []])
  })

  it('묻는 동안 push 가 왔으면 늦게 온 전체로 덮지 않는다', async () => {
    const t = fake()
    t.push([job('p-00000002')])
    t.answer([job('p-00000001')])
    await flush()
    expect(t.seen).toEqual([['p-00000002']])
  })
})
