import type { DeepReadonly } from 'vue'
import { jobName, type JobView } from '../../../shared/job'
import { sidebarLabel, type SidebarLabel } from '../../../shared/names'
import { paneName, type CommandView } from '../../../shared/pane-name'
import type { ProgramStatusRecord, ProgramStatusState } from '../../../shared/program-status'
import type { PtyNotification } from '../../../shared/pty-state'
import type { GitHead } from '../../../shared/git'
import { AGENT_ICONS, commandClass, commandIcon, STATE_LABELS, type PaneIcon } from '../icons'
import { relativeTo, tildePath } from './cwd'
import { commandLabel, notificationText } from './display'
import type { Pane } from './store'

export type Row = {
  pane: number
  state?: ProgramStatusState
  icon: PaneIcon
  /** 아이콘 색을 정하는 class. 상태가 있으면 상태, 없으면 `commandClass` 다. */
  tone: string
  /** 프로그램 상태의 메시지. 상태가 없으면 두지 않는다. */
  message?: string
  /** pane 에서 도는 백그라운드 일(`runningTasks`). 없으면 두지 않는다. */
  tasks?: readonly ProgramStatusRecord[]
  /**
   * 카드 머리줄의 아이콘. 루트가 차례를 마쳤는데 하위 일이 돌아 `state` 가 working 이면, 카드는 루트가 보낸 상태로 보여
   * 프로그램은 쉬고 하위 일만 도는 것을 드러낸다. 그 밖에는 두지 않고 `icon`·`tone` 을 쓴다.
   */
  card?: { icon: PaneIcon; tone: string }
  git?: DeepReadonly<GitHead>
  command?: CommandView
  commandTail: boolean
  focused: boolean
  notice?: PtyNotification
  name: string
  text: string
  place?: SidebarLabel
  path?: string
  aria: string
}

export type JobRow = {
  pty: string
  text: string
  ports: string
  started?: number
  exited: boolean
}

export type RowSource = {
  shown: (pty?: string) => ProgramStatusRecord | undefined
  command: (pty?: string) => CommandView | undefined
  notification: (pty?: string) => PtyNotification | undefined
  tasks: (pty?: string) => readonly ProgramStatusRecord[]
  resting: (pty?: string) => 'done' | 'idle' | undefined
  home?: string
  shell?: string
}

// pane 줄의 오른쪽 끝에 그 pane 의 위치를 붙인다. agent 아이콘은 쉬는(idle) 동안만 앞 칸의 상태 아이콘 자리에 둔다.
// agent 아이콘을 오른쪽 끝에 두지 않아야 agent 가 뜨고 끝나도 위치가 움직이지 않기 때문이다. 셸 pane 에서는 명령이 도는 동안과
// 실패한 명령이 남아 있는 동안만 오른쪽 끝에 위치 대신 돈 시간이나 종료 코드를 쓴다. 명령 pane 은 늘 도는 중이라 같은 규칙을 따르면
// 위치를 한 번도 보이지 못하므로, 오른쪽 끝에 늘 위치를 쓴다.
export function paneRow(
  src: RowSource,
  p: DeepReadonly<Pane>,
  focused: boolean,
  base: DeepReadonly<Pane> | undefined
): Row {
  const r = src.shown(p.ptyId)
  const s = r?.state
  const cmd = src.command(p.ptyId)
  const tail = !!cmd && !p.command?.length
  const place = p.cwd && !tail ? sidebarLabel(p, base, src.home) : undefined
  const name = paneName(p, r, src.shell, cmd)
  const notice = src.notification(p.ptyId)
  const tasks = src.tasks(p.ptyId)
  const where = place && [place.name, place.branch, place.sub].filter(Boolean).join(' ')
  const named = where ? `${name}, ${where}` : name
  const label = s ? STATE_LABELS[s] : cmd && commandLabel(cmd)
  const aria = label ? `${label}: ${named}` : named
  const icon = (st: ProgramStatusState | undefined): PaneIcon => {
    const agent = st === 'idle' && r ? AGENT_ICONS.get(r.app) : undefined
    return agent ? { agent } : st ? { state: st } : { command: commandIcon(cmd) }
  }
  const resting = src.resting(p.ptyId)
  return {
    pane: p.key,
    state: s,
    icon: icon(s),
    tone: s ?? commandClass(cmd),
    message: (s && r.message) || undefined,
    ...(tasks.length && { tasks }),
    ...(resting && { card: { icon: icon(resting), tone: resting } }),
    git: p.git,
    command: cmd,
    commandTail: tail,
    focused,
    notice,
    name,
    text: notice ? notice.body || notice.title : name,
    place,
    path: p.cwd && tildePath(p.cwd, src.home),
    aria: notice ? `${aria}. Notification: ${notificationText(notice)}` : aria
  }
}

export function exitText(e: NonNullable<JobView['exit']>): string {
  return e.signal !== null ? `Killed by signal ${e.signal}` : `Exited with code ${e.code}`
}

export function jobRow(j: JobView): JobRow {
  return {
    pty: j.pty,
    text: jobName(j),
    ports: j.ports.map((p) => `:${p}`).join(' '),
    started: j.started,
    exited: !!j.exit
  }
}

/**
 * workspace 헤더에 붙이는 표시다. 접은 workspace 만 그 안의 가장 급한 상태(`state`)를 아이콘으로 보인다. 읽지 않은
 * 알림이 있으면 그 아이콘에 점을 달고(`notified`), 아이콘이 없으면 이름 뒤에 점(`dot`)을 둔다.
 */
export function workspaceMarks(
  folded: boolean,
  state: ProgramStatusState | undefined,
  unread: boolean
): { state?: ProgramStatusState; notified: boolean; dot: boolean } {
  if (!folded) return { notified: false, dot: false }
  return { state, notified: unread, dot: unread && !state }
}

export type DirRow = { dir: string; name: string; path: string }

export function dirRow(dir: string, home?: string): DirRow {
  return {
    dir,
    name: sidebarLabel({ cwd: dir }, undefined, home).name!,
    path: tildePath(dir, home)
  }
}

/**
 * workspace 메뉴의 즐겨찾기 줄이다. 줄에는 디렉토리 이름만 쓰고, `path` 는 workspace 디렉토리(`base`) 아래면 그로부터의
 * 상대 경로를, 밖이면 홈을 `~` 로 쓴 경로를 쓴다. 메뉴 위에 workspace 디렉토리가 이미 보이기 때문이다.
 */
export function favoriteRow(dir: string, base: string | undefined, home?: string): DirRow {
  const row = dirRow(dir, home)
  const rel = relativeTo(dir, base)
  return rel ? { ...row, path: rel } : row
}

/** cell 이 없는 workspace 는 `dir` 줄 하나를 두어, 그 디렉토리에서 cell 을 다시 열 수 있게 한다. */
export function emptyRow(w: { dir?: string; cells: readonly unknown[] }, home?: string): DirRow[] {
  return !w.cells.length && w.dir !== undefined ? [dirRow(w.dir, home)] : []
}
