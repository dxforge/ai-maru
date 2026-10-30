import type { DeepReadonly } from 'vue'
import { jobName, type JobView } from '../../../shared/job'
import { sidebarLabel, type SidebarLabel } from '../../../shared/names'
import { paneName, type CommandView } from '../../../shared/pane-name'
import type { ProgramStatusRecord, ProgramStatusState } from '../../../shared/program-status'
import type { PtyNotification } from '../../../shared/pty-state'
import { AGENT_ICONS, commandIcon, STATE_LABELS } from '../icons'
import { tildePath } from './cwd'
import { commandLabel, notificationText } from './display'
import type { Pane } from './store'

/** pane 줄 앞 칸에 그리는 것이다. `agent` 와 `glyph` 는 Nerd Font 글자이고, `state` 는 `StatusIcon` 으로 그린다. */
export type PaneIcon = { agent: string } | { state: ProgramStatusState } | { glyph: string }

export type Row = {
  pane: number
  state?: ProgramStatusState
  icon: PaneIcon
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
  tip: string
  ports: string
  started?: number
  exited: boolean
}

export type RowSource = {
  shown: (pty?: string) => ProgramStatusRecord | undefined
  command: (pty?: string) => CommandView | undefined
  notification: (pty?: string) => PtyNotification | undefined
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
  base: DeepReadonly<Pane>
): Row {
  const r = src.shown(p.ptyId)
  const s = r?.state
  const cmd = src.command(p.ptyId)
  const tail = !!cmd && !p.command?.length
  const place = p.cwd && !tail ? sidebarLabel(p, base, src.home) : undefined
  const name = paneName(p, r, src.shell, cmd)
  const notice = src.notification(p.ptyId)
  const where = place && [place.name, place.branch, place.sub].filter(Boolean).join(' ')
  const named = where ? `${name}, ${where}` : name
  const label = s ? STATE_LABELS[s] : cmd && commandLabel(cmd)
  const aria = label ? `${label}: ${named}` : named
  const agent = s === 'idle' && r ? AGENT_ICONS.get(r.app) : undefined
  return {
    pane: p.key,
    state: s,
    icon: agent ? { agent } : s ? { state: s } : { glyph: commandIcon(cmd) },
    command: cmd,
    commandTail: tail,
    focused,
    notice,
    name,
    text: notice ? notice.title || notice.body : name,
    place,
    path: p.cwd && tildePath(p.cwd, src.home),
    aria: notice ? `${aria}. Notification: ${notificationText(notice)}` : aria
  }
}

export function exitText(e: NonNullable<JobView['exit']>): string {
  return e.signal !== null ? `Killed by signal ${e.signal}` : `Exited with code ${e.code}`
}

export function jobRow(j: JobView): JobRow {
  const command = j.command.join(' ')
  return {
    pty: j.pty,
    text: jobName(j),
    tip: j.exit ? `${command}\n${exitText(j.exit)}` : command,
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
