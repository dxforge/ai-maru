import type { GitHead } from '../../../shared/git'
import { jobName, type JobView } from '../../../shared/job'
import {
  programName,
  URGENCY,
  type ProgramStatusRecord,
  type ProgramStatusState
} from '../../../shared/program-status'
import { STATE_LABELS } from '../icons'
import { commandLabel, elapsed, notificationText } from './display'
import { exitText, type DirRow, type Row } from './sidebarRows'

/**
 * 사이드바 카드의 구역 하나. cell 카드는 pane·job 마다 구역을 하나씩 둔다. `key` 는 pane 이면 `pane:<key>`, job 이면
 * `job:<pty>` 다.
 */
export type CardSection = {
  key: string
  title: string
  /** 읽지 않은 알림 */
  notice?: string
  /** 이름 아래 회색 줄. workspace 이름을 바꿨을 때의 자동 이름이다. */
  note?: string
  path?: string
  /** `repo · branch · sub` */
  git?: string
  status?: { state: ProgramStatusState; text: string; message?: string }
  /** 셸 pane 에서 도는(또는 실패한) 명령의 상태 */
  command?: { running: boolean; text: string }
  /** job 의 명령 전체 */
  run?: string
  /** job 의 돈 시간·포트, 끝났으면 끝난 까닭 */
  time?: string
}

/** 카드 아래 띠. `states` 는 상태별 pane 수, `state` 는 그 가운데 가장 급한 상태다. */
export type CardFoot = { state?: ProgramStatusState; states?: string; counts: string }

export type CardView = { sections: CardSection[]; foot?: CardFoot }

/** 카드 요소의 id. 카드를 띄운 줄의 `aria-describedby` 가 가리킨다. */
export const SIDEBAR_CARD_ID = 'sidebar-card'

const plural =(n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function paneSection(
  r: Row,
  git: GitHead | undefined,
  rec: ProgramStatusRecord | undefined,
  now: number
): CardSection {
  const c = r.command
  const time = c?.running && c.startedAt !== undefined ? elapsed(now - c.startedAt) : undefined
  return {
    key: `pane:${r.pane}`,
    title: r.name,
    ...(r.notice && { notice: notificationText(r.notice) }),
    ...(r.path && { path: r.path }),
    ...(git && { git: [git.repo, git.branch, git.sub].filter(Boolean).join(' · ') }),
    ...(r.state &&
      rec && {
        status: {
          state: r.state,
          text: `${STATE_LABELS[r.state]} · ${programName(rec.app)}`,
          ...(rec.message && { message: rec.message })
        }
      }),
    ...(c && {
      command: { running: c.running, text: time ? `${commandLabel(c)} for ${time}` : commandLabel(c) }
    })
  }
}

export function jobSection(j: JobView, now: number): CardSection {
  const ports = j.ports.map((p) => `:${p}`)
  const run = j.started === undefined ? 'Running' : `Running for ${elapsed(now - j.started)}`
  return {
    key: `job:${j.pty}`,
    title: jobName(j),
    run: j.command.join(' '),
    time: j.exit ? exitText(j.exit) : [run, ...ports].join(' · ')
  }
}

/** `states` 는 workspace 의 pane 마다의 상태다. 상태가 없는 pane 은 `undefined` 다. */
export function workspaceCard(w: {
  name: string
  auto: string
  dir?: string
  states: readonly (ProgramStatusState | undefined)[]
  cells: number
  jobs: number
}): CardView {
  const counts = new Map<ProgramStatusState, number>()
  for (const s of w.states) if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
  const order = URGENCY.filter((s) => counts.has(s))
  return {
    sections: [
      {
        key: 'workspace',
        title: w.name,
        ...(w.name !== w.auto && { note: `Default name: ${w.auto}` }),
        ...(w.dir !== undefined && { path: w.dir })
      }
    ],
    foot: {
      ...(order.length && {
        state: order[0],
        states: order.map((s) => `${counts.get(s)} ${STATE_LABELS[s]}`).join(' · ')
      }),
      counts: [
        plural(w.cells, 'cell'),
        plural(w.states.length, 'pane'),
        ...(w.jobs ? [plural(w.jobs, 'job')] : [])
      ].join(' · ')
    }
  }
}

export function dirCard(d: DirRow): CardView {
  return {
    sections: [{ key: 'dir', title: d.name, path: d.path }],
    foot: { counts: 'No open cells' }
  }
}
