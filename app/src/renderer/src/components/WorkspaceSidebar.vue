<script setup lang="ts">
import { computed, ref, useTemplateRef, type DeepReadonly } from 'vue'
import type { JobView } from '../../../shared/job'
import { autoWorkspaceName, labelBase } from '../../../shared/names'
import type { CommandView } from '../../../shared/pane-name'
import type { ProgramStatusRecord, ProgramStatusState } from '../../../shared/program-status'
import type { PtyNotification } from '../../../shared/pty-state'
import { commandClass, ICONS, STATE_LABELS } from '../icons'
import FoldChevron from './FoldChevron.vue'
import StatusIcon from './StatusIcon.vue'
import WorkspaceNameInput from './WorkspaceNameInput.vue'
import { commandLabel, commandTail, elapsed, notificationText } from '../workspace/display'
import {
  dropAt,
  scrollStep,
  trackPointer,
  type DragSession,
  type Dragged,
  type DropAt,
  type SidebarSpans,
  type Span
} from '../workspace/sidebarDrag'
import {
  closedPins,
  jobRow,
  paneRow,
  workspaceMarks,
  type JobRow,
  type PinRow,
  type Row,
  type RowSource
} from '../workspace/sidebarRows'
import PinIcon from './PinIcon.vue'
import {
  focusedPane,
  orderedPanes,
  pinnedCount,
  type Cell,
  type Pane,
  type Workspace
} from '../workspace/store'

const {
  workspaces,
  selectedKey,
  shown,
  command,
  notification,
  urgent,
  unread,
  favorites = new Set(),
  pins = new Map(),
  folded,
  collapsed,
  jobs = [],
  now = 0,
  home = undefined,
  shell = undefined,
  renaming = null
} = defineProps<{
  workspaces: readonly DeepReadonly<Workspace>[]
  selectedKey: number | null
  shown: (pty?: string) => ProgramStatusRecord | undefined
  command: (pty?: string) => CommandView | undefined
  notification: (pty?: string) => PtyNotification | undefined
  urgent: ReadonlyMap<number, ProgramStatusState>
  /** 읽지 않은 알림이 있는 pane 을 든 workspace 의 key */
  unread: ReadonlySet<number>
  /** 즐겨찾기에 든 workspace 의 key */
  favorites?: ReadonlySet<number>
  /** 즐겨찾기에 든 workspace 의 key 에서 그 즐겨찾기 항목의 핀으로 */
  pins?: ReadonlyMap<number, readonly string[]>
  folded: ReadonlySet<number>
  collapsed: boolean
  jobs?: readonly JobView[]
  now?: number
  home?: string
  shell?: string
  /** 이름을 고치는 중인 workspace 의 key */
  renaming?: number | null
}>()

const emit = defineEmits<{
  focus: [cell: number, pane: number]
  fold: [workspace: number]
  killJob: [pty: string]
  moveCell: [cell: number, to: { workspace: number; index: number } | 'new']
  moveWorkspace: [workspace: number, index: number]
  startRename: [workspace: number]
  /** `name` 이 null 이면 취소다. `refocus` 면 터미널에 포커스를 돌려준다. */
  endRename: [workspace: number, name: string | null, refocus: boolean]
  toggleFavorite: [workspace: number]
  togglePin: [cell: number]
  openPin: [workspace: number, dir: string]
  unpin: [workspace: number, dir: string]
}>()

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

function cellGroup(
  src: RowSource,
  c: DeepReadonly<Cell>,
  base: DeepReadonly<Pane> | undefined,
  index: number,
  favorite: boolean
) {
  const selected = c.key === selectedKey
  const current = focusedPane(c)
  return {
    kind: 'cell' as const,
    c,
    index,
    selected,
    pinned: favorite && c.pin !== undefined,
    rows: orderedPanes(c).map((p) => paneRow(src, p, selected && p === current, base))
  }
}

type Item = ReturnType<typeof cellGroup> | ({ kind: 'pin' } & PinRow)

function items(src: RowSource, w: DeepReadonly<Workspace>): Item[] {
  const base = labelBase(w)
  const favorite = favorites.has(w.key)
  const cells = w.cells.map((c, i) => cellGroup(src, c, base, i, favorite))
  const at = pinnedCount(w)
  const closed = closedPins(pins.get(w.key) ?? [], w.cells, home).map((p): Item => ({
    kind: 'pin',
    ...p
  }))
  return [...cells.slice(0, at), ...closed, ...cells.slice(at)]
}

const groups = computed(() => {
  const src: RowSource = { shown, command, notification, home, shell }
  return workspaces.map((w) => {
    const f = folded.has(w.key)
    const auto = autoWorkspaceName(w, home)
    return {
      w,
      name: w.name ?? auto,
      auto,
      folded: f,
      ...workspaceMarks(f, f ? urgent.get(w.key) : undefined, f && unread.has(w.key)),
      items: f ? [] : items(src, w)
    }
  })
})

// `groups` 밖에서 센다. `groups` 안에서 세면 `now` 가 바뀔 때마다 모든 cell 의 줄을 다시 만들기 때문이다.
function jobTime(j: JobRow): string {
  if (j.exited) return 'exited'
  return j.started === undefined ? '' : elapsed(now - j.started)
}

// 이름 자리에서 잘릴 수 있는 명령을 툴팁에 다 보인다. 돈 시간이 들어가므로 `groups` 밖에서 만든다.
function paneTip(r: Row): string {
  const c = r.command
  const time = c?.running && commandTail(c, now)
  const detail = c && (time ? `${commandLabel(c)} for ${time}` : commandLabel(c))
  const head = r.notice ? `${r.name} — ${notificationText(r.notice)}` : r.name
  return [head, detail, r.path].filter(Boolean).join('\n')
}

const nav = useTemplateRef<HTMLElement>('nav')
const list = useTemplateRef<HTMLElement>('list')
const dragged = ref<Dragged | null>(null)
/** 놓을 곳. `line` 은 `.list` 의 스크롤 내용 맨 위를 0 으로 잰 y 다. 목록이 스크롤돼도 선이 틈에 붙어 있게 하기 위해서다. */
const target = ref<DropAt | undefined>()

const sameTarget = (a: DropAt | undefined, b: DropAt | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

const spanOf = (el: Element): Span => {
  const r = el.getBoundingClientRect()
  return { top: r.top, bottom: r.bottom }
}

function spans(): SidebarSpans {
  const slot = list.value!.querySelector(':scope > .new-workspace')
  return {
    workspaces: Array.from(
      list.value!.querySelectorAll<HTMLElement>(':scope > .workspace'),
      (el) => {
        const key = Number(el.dataset.workspace)
        const w = workspaces.find((x) => x.key === key)
        return {
          ...spanOf(el),
          key,
          head: spanOf(el.querySelector(':scope > .workspace-head')!),
          count: w?.cells.length ?? 0,
          cells: Array.from(el.querySelectorAll(':scope > .group'), spanOf),
          pinned: w ? pinnedCount(w) : 0,
          closed: closedSpan(Array.from(el.querySelectorAll(':scope > .pin-card'), spanOf))
        }
      }
    ),
    newWorkspace: slot ? spanOf(slot) : undefined
  }
}

const closedSpan = (s: Span[]): Span | undefined =>
  s.length ? { top: s[0].top, bottom: s[s.length - 1].bottom } : undefined

function drag(what: Dragged, source: HTMLElement, from: PointerEvent): DragSession {
  const r = source.getBoundingClientRect()
  const ghost = source.cloneNode(true) as HTMLElement
  ghost.classList.add('ghost')
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` })
  nav.value!.append(ghost)
  dragged.value = what
  const el = list.value!
  // 끄는 동안 사이드바와 `.list` 의 화면 위치와 크기는 바뀌지 않으므로 처음에 한 번만 잰다.
  const bounds = spanOf(el)
  const side = nav.value!.getBoundingClientRect()
  let x = from.clientX
  let y = from.clientY
  // 포인터가 사이드바 밖이면 놓을 곳을 고르지 않아, 거기서 떼면 아무것도 옮기지 않는다. 터미널 위에서 뗀 버튼이 그 높이의
  // 자리로 cell 을 옮기지 않게 하기 위해서다.
  const inside = (): boolean => x >= side.left && x < side.right && y >= side.top && y < side.bottom
  const pick = (): void => {
    const at = inside() ? dropAt(what, spans(), y) : undefined
    const next = at?.line === undefined ? at : { ...at, line: at.line - bounds.top + el.scrollTop }
    if (!sameTarget(next, target.value)) target.value = next
  }
  const finish = (): void => {
    ghost.remove()
    dragged.value = null
    target.value = undefined
  }
  return {
    move(m) {
      x = m.clientX
      y = m.clientY
      ghost.style.transform = `translate(${m.clientX - from.clientX}px, ${y - from.clientY}px)`
      pick()
    },
    frame() {
      const step = scrollStep(bounds, y)
      if (!step) return
      el.scrollTop += step
      pick()
    },
    drop() {
      // 포인터가 멈춰 있는 동안 cell 이 닫혀 목록이 바뀌었을 수 있으므로, 놓기 전에 놓을 곳을 다시 고른다.
      pick()
      const t = target.value?.drop
      finish()
      if (!t) return
      if (what.kind === 'workspace') {
        if (t.kind === 'workspace') emit('moveWorkspace', what.workspace, t.index)
      } else if (t.kind !== 'workspace')
        emit('moveCell', what.cell, t.kind === 'new-workspace' ? 'new' : t)
    },
    cancel: finish
  }
}

// 손잡이는 클릭 동작이 없으므로 누르자마자 끌기를 시작한다.
function grabCell(e: PointerEvent, workspace: number, cell: number, index: number): void {
  const card = (e.currentTarget as HTMLElement).closest<HTMLElement>('.group')!
  const what = { kind: 'cell', cell, workspace, index } as const
  trackPointer(e, 0, () => drag(what, card, e))
}

/** 이름 줄은 누른 뒤 이만큼 움직이면 끌기로 보고, 그 전에 떼면 접기·펴기다. */
const HEAD_THRESHOLD = 4

function grabWorkspace(e: PointerEvent, workspace: number, index: number): void {
  const head = e.currentTarget as HTMLElement
  trackPointer(e, HEAD_THRESHOLD, () => drag({ kind: 'workspace', workspace, index }, head, e))
}

const cellDragged = (cell: number): boolean =>
  dragged.value?.kind === 'cell' && dragged.value.cell === cell
const workspaceDragged = (workspace: number): boolean =>
  dragged.value?.kind === 'workspace' && dragged.value.workspace === workspace
const favoriteLabel = (workspace: number): string =>
  favorites.has(workspace) ? 'Remove from Favorites' : 'Add to Favorites'
const pinLabel = (pinned: boolean): string => (pinned ? 'Unpin' : 'Pin')
</script>

<template>
  <nav ref="nav" class="sidebar" :class="{ collapsed }">
    <div class="titlebar" />
    <div ref="list" v-overlay-scroll="'y'" class="list">
      <div
        v-for="({ w, name, auto, folded: wf, state, notified, dot, items: entries }, wi) in groups"
        :key="w.key"
        class="workspace"
        :class="{ dragging: workspaceDragged(w.key) }"
        :data-workspace="w.key"
      >
        <div v-if="renaming === w.key" class="workspace-head editing">
          <WorkspaceNameInput
            :value="name"
            @done="(n, refocus) => emit('endRename', w.key, n, refocus)"
          />
        </div>
        <button
          v-else
          v-tooltip="auto"
          class="workspace-head"
          :class="{ folded: wf }"
          :aria-label="wf ? `Expand ${name}` : `Collapse ${name}`"
          :aria-expanded="!wf"
          @mousedown.prevent
          @pointerdown="grabWorkspace($event, w.key, wi)"
          @click="emit('fold', w.key)"
          @dblclick="emit('startRename', w.key)"
        >
          <span
            v-if="state"
            v-tooltip="STATE_LABELS[state]"
            class="state status-icon"
            :class="[state, { unread: notified }]"
            ><StatusIcon :state="state"
          /></span>
          <span class="workspace-name">{{ name }}</span>
          <span v-if="dot" class="unread-dot" />
          <!-- workspace 헤더가 button 이라 그 안에 button 을 넣지 못한다. 별의 pointerdown·click·dblclick 이 헤더의 끌기·접기·이름 고치기로 전해지지 않게 막는다. -->
          <span class="favorite-slot" :class="{ on: favorites.has(w.key) }"
            ><span
              v-tooltip="favoriteLabel(w.key)"
              role="button"
              class="favorite nerd-icon"
              :class="{ on: favorites.has(w.key) }"
              :aria-label="favoriteLabel(w.key)"
              :aria-pressed="favorites.has(w.key)"
              @pointerdown.stop
              @click.stop="emit('toggleFavorite', w.key)"
              @dblclick.stop
              >{{ favorites.has(w.key) ? ICONS.starFull : ICONS.starEmpty }}</span
            ></span
          >
          <FoldChevron class="chevron" :open="!wf" />
        </button>
        <template
          v-for="item in entries"
          :key="item.kind === 'cell' ? item.c.key : `pin:${item.dir}`"
        >
          <div v-if="item.kind === 'pin'" class="pin-card">
            <button
              v-tooltip="item.path"
              class="row closed-pin"
              :aria-label="`Open ${item.name}`"
              @mousedown.prevent
              @click="emit('openPin', w.key, item.dir)"
            >
              <span class="state nerd-icon">{{ ICONS.terminal }}</span>
              <span class="title">{{ item.name }}</span>
              <span class="tail">{{ item.path }}</span>
            </button>
            <button
              v-tooltip="pinLabel(true)"
              class="pin on"
              :aria-label="`Unpin ${item.name}`"
              aria-pressed="true"
              @mousedown.prevent
              @click="emit('unpin', w.key, item.dir)"
            >
              <PinIcon :filled="true" />
            </button>
          </div>
          <div
            v-else
            class="group"
            :class="{ selected: item.selected, dragging: cellDragged(item.c.key) }"
          >
            <span
              class="grip"
              aria-hidden="true"
              @mousedown.prevent
              @pointerdown="grabCell($event, w.key, item.c.key, item.index)"
            />
            <button
              v-for="r in item.rows"
              :key="r.pane"
              v-tooltip="paneTip(r)"
              class="row pane-row"
              :class="[r.state ?? ['shell', commandClass(r.command)], { focused: r.focused }]"
              :aria-label="r.aria"
              @mousedown.prevent
              @click="emit('focus', item.c.key, r.pane)"
            >
              <span
                v-tooltip="r.state && STATE_LABELS[r.state]"
                class="state status-icon"
                :class="{ 'nerd-icon': !('state' in r.icon), unread: r.notice }"
                ><StatusIcon v-if="'state' in r.icon" :state="r.icon.state" /><template v-else>{{
                  'agent' in r.icon ? r.icon.agent : r.icon.glyph
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
              <span v-else-if="r.command && r.commandTail" class="tail command-tail">{{
                commandTail(r.command, now)
              }}</span>
            </button>
            <div
              v-for="j in jobsByCell.get(item.c.id)"
              :key="j.pty"
              v-tooltip="j.tip"
              class="row job-row"
              :class="{ exited: j.exited }"
            >
              <span class="state nerd-icon">{{ ICONS.gear }}</span>
              <span class="title">{{ j.text }}</span>
              <span v-if="j.ports" class="tail ports">{{ j.ports }}</span>
              <span class="tail time">{{ jobTime(j) }}</span>
              <button
                v-tooltip="j.exited ? 'Remove' : 'Stop'"
                class="tail kill nerd-icon"
                :aria-label="j.exited ? `Remove ${j.text}` : `Stop ${j.text}`"
                @mousedown.prevent
                @click="emit('killJob', j.pty)"
              >
                {{ ICONS.close }}
              </button>
            </div>
            <button
              v-tooltip="pinLabel(item.pinned)"
              class="pin"
              :class="{ on: item.pinned }"
              :aria-label="pinLabel(item.pinned)"
              :aria-pressed="item.pinned"
              @mousedown.prevent
              @click="emit('togglePin', item.c.key)"
            >
              <PinIcon :filled="item.pinned" />
            </button>
          </div>
        </template>
      </div>
      <div
        v-if="dragged?.kind === 'cell'"
        class="new-workspace"
        :class="{ target: target?.drop.kind === 'new-workspace' }"
      >
        New Workspace
      </div>
      <div
        v-if="target?.line !== undefined"
        class="drop-line"
        :style="{ top: `${target.line}px` }"
      />
    </div>
  </nav>
</template>

<style scoped>
/* 접은 사이드바는 폭을 줄이고 행 끝의 칸을 숨길 뿐이라, 아이콘과 글자의 x 와 행의 높이는 펼친 판과 같다.
   행 앞 칸의 아이콘과 workspace 이름의 첫 글자는 신호등의 첫 원과 같은 x(12px)에 선다. 12px 는 cell 면의 바깥 여백
   6px 와 안쪽 여백 6px 를 더한 값이다. */
.sidebar {
  -webkit-app-region: drag;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  --row-height: 30px;
  background: var(--side);
  font:
    var(--text-3) var(--font-ui),
    'Symbols Nerd Font Mono',
    sans-serif;
}

.titlebar {
  flex: none;
  height: 36px;
  border-bottom: 1px solid var(--line);
}

.list {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: var(--space-3) 0;
}

.workspace-head {
  width: 100%;
  gap: var(--space-4);
  padding: 0 var(--space-5);
  box-sizing: border-box;
  color: var(--muted);
}

.workspace-head:hover {
  color: var(--fg);
}

.workspace-head.editing {
  display: flex;
  align-items: center;
  height: var(--row-height);
}

.workspace-head .chevron {
  flex: none;
  margin-left: auto;
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
  font-size: var(--text-1);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.favorite-slot {
  flex: none;
  align-self: stretch;
  display: flex;
  align-items: center;
}

/* 즐겨찾기가 아닌 workspace 의 별은 hover·focus 때만 보이므로 이름 폭을 줄이지 않는다. 접은 사이드바에서 이름이 별 폭만큼
   더 잘리지 않게 하기 위해서다. 별의 자리는 이름보다 먼저 0 까지 준다. 자리가 줄면 별은 자리의 오른쪽 끝에 붙은 채 왼쪽으로
   넘쳐 이름 끝 글자를 가린다. 이름 뒤에 빈 폭이 있으면 별은 이름 뒤에 선다. 자리의 왼쪽 margin 은 헤더의 gap 을 빼고, 별의
   왼쪽 margin 이 그 gap 을 별 앞에 다시 둔다. */
.favorite-slot:not(.on) {
  flex: 0 1000 auto;
  min-width: 0;
  justify-content: flex-end;
  margin-left: calc(-1 * var(--space-4));
}

.favorite-slot:not(.on) .favorite {
  flex: none;
  margin-left: var(--space-4);
  background-color: var(--side);
}

.favorite {
  visibility: hidden;
  padding: 0 var(--space-1);
  border-radius: var(--radius-1);
  font-size: 12px;
  line-height: 20px;
}

.favorite.on,
.workspace-head:hover .favorite,
.workspace-head:focus-visible .favorite {
  visibility: visible;
}

/* 이름 위에 겹친 별은 바탕색으로 이름을 가리므로, hover 색은 바탕색 위에 덧칠한다. */
.favorite:hover {
  background-image: linear-gradient(var(--hover), var(--hover));
}

/* 상태 아이콘이 없는 접은 workspace 는 이름 뒤에 점(`.unread-dot`, `style.css`)을 붙여 위로 올린다. 이름은 길면 말줄임으로
   잘리므로 점을 이름 위에 겹치지 않는다. */
.unread-dot {
  flex: none;
  margin-left: -6px;
  transform: translateY(-5px);
}

/* workspace 사이에는 선을 긋고 선 위아래를 같은 폭으로 띄운다. 접은 workspace 와 펼친 workspace 의 간격이 같도록 마지막
   cell 의 아래 여백은 뺀다. */
.workspace + .workspace {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}

.group:last-child,
.pin-card:last-child {
  margin-bottom: 0;
}

/* 핀이 박스 모서리 밖으로 나오므로 박스는 넘친 것을 자르지 않고, 줄의 바탕색은 박스의 첫 줄과 마지막 줄의 모서리를 깎아
   박스 안에 둔다. */
.group,
.pin-card {
  position: relative;
  margin: 0 var(--space-3) var(--space-3);
  border-radius: var(--radius-2);
}

.grip + .row,
.closed-pin {
  border-top-left-radius: var(--radius-2);
  border-top-right-radius: var(--radius-2);
}

.group > .row:nth-last-child(2),
.closed-pin {
  border-bottom-left-radius: var(--radius-2);
  border-bottom-right-radius: var(--radius-2);
}

.group {
  background: color-mix(in srgb, var(--fg) 4%, transparent);
}

.group.selected {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}

.closed-pin {
  color: var(--faint);
}

/* 테두리 대신 안쪽으로 그은 outline 이라 박스 높이가 열린 cell 과 같다. */
.pin-card {
  outline: 1px dashed color-mix(in srgb, var(--fg) 18%, transparent);
  outline-offset: -1px;
}

.closed-pin:hover {
  background: var(--hover);
}

.closed-pin .tail {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--text-1);
}

/* 압정처럼 박스의 오른쪽 위 모서리에 비스듬히 꽂는다. 줄 폭을 쓰지 않아 이름이 핀 때문에 더 잘리지 않는다. */
.pin {
  position: absolute;
  top: -7px;
  right: -5px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  color: var(--faint);
  visibility: hidden;
}

.pin svg {
  width: 13px;
  height: 13px;
  transform: rotate(35deg);
}

.pin.on {
  color: var(--accent);
}

.pin.on,
.group:hover .pin {
  visibility: visible;
}

.pin:not(.on):hover {
  color: var(--fg);
}

button {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  height: var(--row-height);
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

/* 손잡이는 첫 행 위에 겹친 형제 요소라, 마우스가 손잡이 위에 있으면 첫 행은 :hover 를 잃는다. */
.pane-row:hover,
.group:not(.dragging) > .grip:hover + .pane-row:not(.focused) {
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
  gap: var(--space-2);
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
  height: var(--row-height);
  gap: var(--space-2);
  padding: 0 var(--space-3);
  box-sizing: border-box;
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
  margin-left: var(--space-2);
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

.command-tail {
  font-size: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.command-failed .command-tail {
  color: var(--error);
}

.place {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 0 1 auto;
  min-width: 0;
  max-width: 60%;
  font-size: var(--text-1);
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
  font-size: var(--text-1);
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
  border-radius: var(--radius-1);
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

.grip {
  -webkit-app-region: no-drag;
  position: absolute;
  top: 0;
  left: 50%;
  z-index: 1;
  display: grid;
  place-items: start center;
  width: 24px;
  height: 10px;
  padding-top: 1px;
  box-sizing: border-box;
  transform: translateX(-50%);
  color: var(--fg);
  cursor: grab;
  opacity: 0;
}

/* 점 중심을 가로·세로 모두 정수 px 에 두어야 1x 화면에서 점이 2×2px 로 찍힌다. 높이 3px 타일의 가운데(1.5px)에 두면
   점이 가로 2px·세로 1px 로 납작하게 찍힌다. */
.grip::before {
  content: '';
  width: 12px;
  height: 6px;
  background-image: radial-gradient(circle at 2px 1px, currentColor 0.85px, transparent 1.1px);
  background-size: 4px 3px;
}

.group:hover .grip {
  opacity: 0.35;
}

.group .grip:hover {
  opacity: 0.8;
}

.dragging {
  opacity: 0.35;
}

.dragging .grip,
.dragging .grip:hover {
  opacity: 0;
}

/* 사본이 `.group.selected` 의 배경색보다 우선하도록 `.sidebar` 를 붙인다. */
.sidebar .ghost {
  position: fixed;
  z-index: 10;
  margin: 0;
  border-radius: var(--radius-2);
  background: color-mix(in srgb, var(--fg) 12%, var(--side));
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
  opacity: 0.92;
  pointer-events: none;
}

.ghost .grip {
  display: none;
}

.drop-line {
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  margin-top: -1px;
  border-radius: 1px;
  background: var(--accent);
  pointer-events: none;
}

.new-workspace {
  display: grid;
  place-items: center;
  height: var(--row-height);
  margin: var(--space-4) var(--space-3) 0;
  border: 1px dashed var(--accent);
  border-radius: var(--radius-2);
  color: var(--accent);
  font-size: var(--text-2);
}

.new-workspace.target {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}
</style>
