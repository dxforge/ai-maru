<script setup lang="ts">
import { computed, type DeepReadonly } from 'vue'
import type { JobView } from '../../../shared/job'
import { sidebarLabel, workspaceName, type SidebarLabel } from '../../../shared/names'
import type { ProgramStatusRecord, ProgramStatusState } from '../../../shared/program-status'
import { AGENT_ICONS, ICONS, STATE_LABELS } from '../icons'
import StatusIcon from './StatusIcon.vue'
import { tildePath } from '../workspace/cwd'
import { elapsed, paneName } from '../workspace/display'
import { focusedPane, type Cell, type Pane, type Workspace } from '../workspace/store'

const {
  workspaces,
  selectedKey,
  root,
  urgent,
  folded,
  collapsed,
  jobs = [],
  now = 0,
  home = undefined,
  shell = undefined
} = defineProps<{
  workspaces: readonly DeepReadonly<Workspace>[]
  selectedKey: number | null
  root: (pty?: string) => ProgramStatusRecord | undefined
  urgent: ReadonlyMap<number, ProgramStatusState>
  folded: ReadonlySet<number>
  collapsed: boolean
  jobs?: readonly JobView[]
  now?: number
  home?: string
  shell?: string
}>()

const emit = defineEmits<{
  focus: [cell: number, pane: number]
  fold: [workspace: number]
  killJob: [pty: string]
}>()

type Row = {
  pane: number
  state?: ProgramStatusState
  agent?: string
  focused: boolean
  text: string
  place?: SidebarLabel
  tip: string
  aria: string
}

type JobRow = {
  pty: string
  text: string
  tip: string
  ports: string
  started?: number
  exited: boolean
}

// 모든 pane 줄의 오른쪽 끝에 그 pane 의 위치를 붙인다. agent 아이콘은 쉬는(idle) 동안만 앞 칸의 상태 아이콘 자리에 둔다.
// 오른쪽 끝을 위치만 쓰게 해서, agent 가 뜨고 끝나도 위치가 움직이지 않게 하기 위해서다.
function paneRow(p: DeepReadonly<Pane>, focused: boolean, base: DeepReadonly<Pane>): Row {
  const r = root(p.ptyId)
  const s = r?.state
  const place = p.cwd ? sidebarLabel(p, base, home) : undefined
  const text = paneName(p, r, shell)
  const where = place && [place.name, place.branch, place.sub].filter(Boolean).join(' ')
  const name = where ? `${text}, ${where}` : text
  const path = p.cwd && tildePath(p.cwd, home)
  return {
    pane: p.key,
    state: s,
    agent: s === 'idle' && r ? AGENT_ICONS.get(r.app) : undefined,
    focused,
    text,
    place,
    tip: path ? `${text}\n${path}` : text,
    aria: s ? `${STATE_LABELS[s]}: ${name}` : name
  }
}

function exitText(e: NonNullable<JobView['exit']>): string {
  return e.signal !== null ? `Killed by signal ${e.signal}` : `Exited with code ${e.code}`
}

function jobRow(j: JobView): JobRow {
  const command = j.command.join(' ')
  return {
    pty: j.pty,
    text: j.name ?? command,
    tip: j.exit ? `${command}\n${exitText(j.exit)}` : command,
    ports: j.ports.map((p) => `:${p}`).join(' '),
    started: j.started,
    exited: !!j.exit
  }
}

// `groups` 밖에 둔다. `groups` 안에 두면 job 표가 바뀔 때마다 job 과 상관없는 pane 줄까지 다시 만들기 때문이다.
const jobsByCell = computed(() => {
  const map = new Map<string, JobRow[]>()
  for (const j of jobs) {
    const row = jobRow(j)
    const list = map.get(j.cell)
    if (list) list.push(row)
    else map.set(j.cell, [row])
  }
  return map
})

function cellGroup(c: DeepReadonly<Cell>, base: DeepReadonly<Pane>) {
  const selected = c.key === selectedKey
  const current = focusedPane(c)
  return {
    c,
    selected,
    rows: c.panes.map((p) => paneRow(p, selected && p === current, base))
  }
}

const groups = computed(() =>
  workspaces.map((w) => {
    const base = w.cells[0].panes[0]
    const f = folded.has(w.key)
    return {
      w,
      name: workspaceName(base, home),
      folded: f,
      state: f ? urgent.get(w.key) : undefined,
      cells: f ? [] : w.cells.map((c) => cellGroup(c, base))
    }
  })
)

// `groups` 밖에서 센다. `groups` 안에서 세면 `now` 가 바뀔 때마다 모든 cell 의 줄을 다시 만들기 때문이다.
function jobTime(j: JobRow): string {
  if (j.exited) return 'exited'
  return j.started === undefined ? '' : elapsed(now - j.started)
}
</script>

<template>
  <nav class="sidebar" :class="{ collapsed }">
    <div class="titlebar" />
    <div class="list">
      <div v-for="{ w, name, folded: wf, state, cells } in groups" :key="w.key" class="workspace">
        <button
          class="workspace-head"
          :class="{ folded: wf }"
          :title="name"
          :aria-label="wf ? `Expand ${name}` : `Collapse ${name}`"
          :aria-expanded="!wf"
          @mousedown.prevent
          @click="emit('fold', w.key)"
        >
          <span v-if="state" class="state status-icon" :class="state" :title="STATE_LABELS[state]"
            ><StatusIcon :state="state"
          /></span>
          <span class="workspace-name">{{ name }}</span>
          <span class="chevron nerd-icon">{{ wf ? ICONS.collapsed : ICONS.expanded }}</span>
        </button>
        <div
          v-for="{ c, selected, rows } in cells"
          :key="c.key"
          class="group"
          :class="{ selected }"
        >
          <button
            v-for="r in rows"
            :key="r.pane"
            class="row pane-row"
            :class="[r.state ?? 'shell', { focused: r.focused }]"
            :title="r.tip"
            :aria-label="r.aria"
            @mousedown.prevent
            @click="emit('focus', c.key, r.pane)"
          >
            <span
              class="state status-icon"
              :class="{ 'nerd-icon': !r.state || r.agent }"
              :title="r.state && STATE_LABELS[r.state]"
              ><template v-if="r.agent">{{ r.agent }}</template
              ><StatusIcon v-else-if="r.state" :state="r.state" /><template v-else>{{
                ICONS.terminal
              }}</template></span
            >
            <span class="title">{{ r.text }}</span>
            <span v-if="r.place" class="tail place"
              ><span v-if="r.place.name" class="name">{{ r.place.name }}</span
              ><span v-if="r.place.branch" class="branch"
                ><span class="nerd-icon">{{ ICONS.branch }}</span
                ><span class="branch-name">{{ r.place.branch }}</span></span
              ><span v-if="r.place.sub" class="sub">· {{ r.place.sub }}</span></span
            >
          </button>
          <div
            v-for="j in jobsByCell.get(c.id)"
            :key="j.pty"
            class="row job-row"
            :class="{ exited: j.exited }"
            :title="j.tip"
          >
            <span class="state nerd-icon">{{ ICONS.gear }}</span>
            <span class="title">{{ j.text }}</span>
            <span v-if="j.ports" class="tail ports">{{ j.ports }}</span>
            <span class="tail time">{{ jobTime(j) }}</span>
            <button
              class="tail kill nerd-icon"
              :aria-label="j.exited ? `Remove ${j.text}` : `Stop ${j.text}`"
              :title="j.exited ? 'Remove' : 'Stop'"
              @mousedown.prevent
              @click="emit('killJob', j.pty)"
            >
              {{ ICONS.close }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </nav>
</template>

<style scoped>
/* 접은 사이드바는 오른쪽을 잘라 낼 뿐이라, 아이콘과 글자의 x 와 행의 높이는 펼친 판과 같다. 행 앞 칸의 아이콘과
   workspace 이름의 첫 글자는 신호등의 첫 원과 같은 x(12px)에 선다. 12px 는 cell 면의 바깥 여백 6px 와 안쪽 여백 6px
   를 더한 값이다. */
.sidebar {
  -webkit-app-region: drag;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--side);
  font:
    13px system-ui,
    'Symbols Nerd Font Mono',
    sans-serif;
}

.titlebar {
  flex: none;
  height: 36px;
  border-bottom: 1px solid var(--line);
}

.list {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 6px 0;
}

.workspace-head {
  width: 100%;
  gap: 8px;
  padding: 0 10px 0 12px;
  box-sizing: border-box;
  color: var(--muted);
}

.workspace-head:hover {
  color: var(--fg);
}

.workspace-head .chevron {
  flex: none;
  margin-left: auto;
  font-size: 11px;
  opacity: 0;
}

.workspace-head:hover .chevron,
.workspace-head:focus-visible .chevron,
.workspace-head.folded .chevron {
  opacity: 1;
}

.workspace-name {
  flex: 0 1 auto;
  min-width: 0;
  line-height: 28px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* workspace 사이에는 선을 긋고 선 위아래를 같은 폭으로 띄운다. 접은 workspace 와 펼친 workspace 의 간격이 같도록 마지막
   cell 의 아래 여백은 뺀다. */
.workspace + .workspace {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}

.group:last-child {
  margin-bottom: 0;
}

.group {
  margin: 0 6px 6px;
  border-radius: 6px;
  overflow: hidden;
  background: color-mix(in srgb, var(--fg) 4%, transparent);
}

.group.selected {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}

button {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.pane-row:hover {
  background: var(--hover);
}

.name,
.branch-name,
.sub {
  overflow: hidden;
  text-overflow: ellipsis;
}

.name {
  flex: 0 1 auto;
  min-width: 0;
}

.branch {
  display: flex;
  align-items: center;
  gap: 3px;
  /* 저장소 이름이 길어 줄어들어도 branch 아이콘(11px)은 남긴다. */
  min-width: 11px;
}

.branch .nerd-icon {
  flex: none;
}

.sub {
  flex: none;
  max-width: 50%;
}

.row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 26px;
  gap: 4px;
  padding: 0 6px;
  box-sizing: border-box;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}

.state {
  flex: none;
  width: 14px;
  text-align: center;
  color: var(--claude, var(--faint));
}

.state svg {
  margin: 0 auto;
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tail {
  flex: none;
  margin-left: 4px;
  color: var(--faint);
}

.pane-row.idle .title {
  color: var(--faint);
}

.row.blocked,
.row.error {
  background: color-mix(in srgb, var(--waiting) 14%, transparent);
}

.pane-row.blocked .title,
.pane-row.error .title {
  color: var(--fg);
  font-weight: 600;
}

.pane-row.focused {
  background: var(--selected);
}

.pane-row.focused .title {
  color: var(--fg);
}

.place {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 60%;
  font-size: 11px;
}

.job-row {
  -webkit-app-region: no-drag;
  position: relative;
  cursor: default;
}

.job-row .state {
  color: var(--faint);
}

.ports,
.time {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* 시작 시각이 없는 job(이전 판의 앱이 띄운 것)은 시간 자리가 비므로, hover 때 겹치는 ✕ 가 포트를 덮지 않게 그 폭을 남긴다. */
.time {
  min-width: 16px;
  text-align: right;
}

.job-row.exited {
  opacity: 0.5;
}

/* 키보드로도 닿게 display 대신 opacity 로 숨긴다. 보일 때는 시간 자리에 겹친다. */
.kill {
  position: absolute;
  right: 6px;
  width: 16px;
  height: 16px;
  justify-content: center;
  border-radius: 4px;
  font-size: 12px;
  opacity: 0;
}

.kill:hover {
  background: var(--hover);
  color: var(--fg);
}

.job-row:hover .kill,
.kill:focus-visible {
  opacity: 1;
}

.job-row:hover .time,
.job-row:focus-within .time {
  visibility: hidden;
}

.collapsed .tail,
.collapsed .chevron {
  display: none;
}
</style>
