import { jobName, type JobView } from '../../../shared/job'
import {
  STATE_LABELS,
  URGENCY,
  type ProgramStatusRecord,
  type ProgramStatusState
} from '../../../shared/program-status'
import type { PaneIcon } from '../icons'
import { commandLabel, commandTail, elapsed, notificationText } from './display'
import { exitText, type Row } from './sidebarRows'

/**
 * 사이드바 카드의 구역 하나. cell 카드는 pane·job 마다 구역을 하나씩 둔다. `key` 는 pane 이면 `pane:<key>`, job 이면
 * `job:<pty>` 다.
 */
export type CardSection = {
  key: string
  title: string
  icon?: PaneIcon | 'job'
  /** 아이콘 색을 정하는 class. 사이드바 줄이 다는 상태·명령 class 와 같다. */
  tone?: string
  /** 읽지 않은 알림 */
  notice?: string
  /** 이름 아래 회색 줄. workspace 이름을 바꿨을 때의 자동 이름이다. */
  note?: string
  path?: string
  /** `repo · branch`. 작업 트리 안의 위치(`sub`)는 `path` 에 이미 있으므로 넣지 않는다. */
  git?: string
  /** 프로그램 상태의 메시지. 상태 자체는 `icon` 이 보인다. */
  message?: string
  /**
   * pane 에서 도는 명령의 돈 시간이나, 실패한 명령의 종료 코드. 셸 pane 의 명령과 명령을 주어 띄운 pane 의 명령이
   * 모두 든다.
   */
  command?: { running: boolean; text: string }
  tasks?: { rows: CardTask[]; more?: string }
  /** job 의 명령 전체 */
  run?: string
  /** job 의 돈 시간·포트, 끝났으면 끝난 까닭 */
  time?: string
}

export type CardTask = { key: string; state: ProgramStatusState; title: string }

export const MAX_TASKS = 5

/** 카드 아래 띠. `states` 는 상태별 pane 수를 급한 상태부터 늘어놓은 것이다. */
export type CardFoot = {
  states?: { state: ProgramStatusState; text: string }[]
  counts: string
}

export type CardView = { sections: CardSection[]; foot?: CardFoot }

export const SIDEBAR_CARD_ID = 'sidebar-card'

/**
 * 카드를 띄운 자리. cell 카드는 cell 안의 pane 줄·job 줄과 cell 자체(`row` 없음)에 단다. `row` 는 강조할 구역의
 * key(`CardSection.key`)다.
 */
export type CardAt =
  { kind: 'cell'; cell: number; row?: string } | { kind: 'head'; workspace: number }

/**
 * 같은 cell 의 줄에서 cell 의 빈 자리(손잡이·줄 사이)로 나오면 앞의 자리를 그대로 둔다. 줄 사이를 옮길 때마다 강조가
 * 꺼졌다 켜지지 않게 하기 위해서다.
 */
export function keepsCardAt(prev: CardAt | undefined, at: CardAt): boolean {
  return (
    at.kind === 'cell' && at.row === undefined && prev?.kind === 'cell' && prev.cell === at.cell
  )
}

/** cell 카드. pane 구역을 사이드바 줄의 순서로 두고, 그 뒤에 job 구역을 둔다. */
export function cellCard(rows: readonly Row[], jobs: readonly JobView[], now: number): CardView {
  return {
    sections: [...rows.map((r) => paneSection(r, now)), ...jobs.map((j) => jobSection(j, now))]
  }
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function paneSection(r: Row, now: number): CardSection {
  const c = r.command
  const time = c?.running ? commandTail(c, now) : undefined
  const notice = r.notice && notificationText(r.notice)
  return {
    key: `pane:${r.pane}`,
    title: r.name,
    icon: r.icon,
    ...(r.tone && { tone: r.tone }),
    ...(notice && { notice }),
    ...(r.path && { path: r.path }),
    ...(r.git && { git: [r.git.repo, r.git.branch].filter(Boolean).join(' · ') }),
    ...(r.message && { message: r.message }),
    ...(c && {
      command: {
        running: c.running,
        text: time ? `${commandLabel(c)} for ${time}` : commandLabel(c)
      }
    }),
    ...(r.tasks && { tasks: taskList(r.tasks) })
  }
}

function taskList(tasks: readonly ProgramStatusRecord[]): NonNullable<CardSection['tasks']> {
  const rows = tasks.slice(0, MAX_TASKS).map((t) => ({
    key: t.id,
    state: t.state,
    title: t.title || t.id
  }))
  const more = tasks.length - rows.length
  return more ? { rows, more: `+${more} more` } : { rows }
}

export function jobSection(j: JobView, now: number): CardSection {
  const ports = j.ports.map((p) => `:${p}`)
  const run = j.started === undefined ? 'Running' : `Running for ${elapsed(now - j.started)}`
  return {
    key: `job:${j.pty}`,
    title: jobName(j),
    icon: 'job',
    run: j.command.join(' '),
    time: j.exit ? exitText(j.exit) : [run, ...ports].join(' · ')
  }
}

/**
 * `states` 는 workspace 의 pane 마다의 상태다. 그 길이를 pane 수로 쓰므로, 상태가 없는 pane 도 `undefined` 로
 * 넣는다.
 */
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
        states: order.map((s) => ({ state: s, text: `${counts.get(s)} ${STATE_LABELS[s]}` }))
      }),
      counts: [
        plural(w.cells, 'cell'),
        plural(w.states.length, 'pane'),
        ...(w.jobs ? [plural(w.jobs, 'job')] : [])
      ].join(' · ')
    }
  }
}
