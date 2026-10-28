import type { PtyExit } from './pty'

/**
 * main 이 창에 보내는 job 하나. `cell` 은 job 이 속한 cell 의 id, `started` 는 띄운 시각(epoch ms), `ports` 는
 * job 과 그 자손이 LISTEN 중인 TCP 포트다. 이전 앱이 띄운 job 에는 `started` 가 없다.
 */
export type JobView = {
  pty: string
  name?: string
  cell: string
  command: string[]
  started?: number
  exit?: PtyExit
  ports: number[]
}
