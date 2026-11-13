<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, type DeepReadonly } from 'vue'
import type { JobView } from '../../../shared/job'
import { autoWorkspaceName, labelBase } from '../../../shared/names'
import type { CommandView } from '../../../shared/pane-name'
import type { ProgramStatusRecord, ProgramStatusState } from '../../../shared/program-status'
import type { PtyNotification } from '../../../shared/pty-state'
import { Anchor as AnchorIcon, EllipsisVertical, Star, X } from '@lucide/vue'
import { anchorWidth, type Anchor } from '../launcher/anchor'
import type { TooltipCard } from '../tooltip'
import FoldChevron from './FoldChevron.vue'
import LeadIcon from './LeadIcon.vue'
import PaneIcon from './PaneIcon.vue'
import PanePlace from './PanePlace.vue'
import SidebarCard from './SidebarCard.vue'
import StatusIcon from './StatusIcon.vue'
import FavoritesMenu from './FavoritesMenu.vue'
import WorkspaceMenu from './WorkspaceMenu.vue'
import { commandTail, elapsed } from '../workspace/display'
import {
  cellCard,
  dirCard,
  keepsCardAt,
  SIDEBAR_CARD_ID,
  workspaceCard,
  type CardAt,
  type CardView
} from '../workspace/sidebarCard'
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
  jobRow,
  paneRow,
  dirRow,
  favoriteRows,
  workspaceMarks,
  type JobRow,
  type RowSource
} from '../workspace/sidebarRows'
import {
  focusedPane,
  findFavorite,
  orderedPanes,
  workspaceDir,
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
  tasks,
  urgent,
  unread,
  folded,
  collapsed,
  jobs = [],
  now = 0,
  home = undefined,
  shell = undefined,
  menuFor = null
} = defineProps<{
  workspaces: readonly DeepReadonly<Workspace>[]
  selectedKey: number | null
  shown: (pty?: string) => ProgramStatusRecord | undefined
  command: (pty?: string) => CommandView | undefined
  notification: (pty?: string) => PtyNotification | undefined
  tasks: (pty?: string) => readonly ProgramStatusRecord[]
  urgent: ReadonlyMap<number, ProgramStatusState>
  /** 읽지 않은 알림이 있는 pane 을 든 workspace 의 key */
  unread: ReadonlySet<number>
  folded: ReadonlySet<number>
  collapsed: boolean
  jobs?: readonly JobView[]
  now?: number
  home?: string
  shell?: string
  menuFor?: number | null
}>()

const emit = defineEmits<{
  focus: [cell: number, pane: number]
  fold: [workspace: number]
  killJob: [pty: string]
  moveCell: [cell: number, to: { workspace: number; index: number } | 'new']
  moveWorkspace: [workspace: number, index: number]
  openMenu: [workspace: number]
  /** `name` 이 null 이면 이름을 바꾸지 않는다. `refocus` 면 터미널에 포커스를 돌려준다. */
  closeMenu: [workspace: number, name: string | null, refocus: boolean]
  toggleKeep: [workspace: number]
  toggleFavorite: [cell: number, pane: number]
  openDir: [workspace: number, dir: string, anchor: Anchor]
  removeFavorite: [workspace: number, dir: string]
  closeWorkspace: [workspace: number]
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
  w: DeepReadonly<Workspace>,
  c: DeepReadonly<Cell>,
  base: DeepReadonly<Pane> | undefined,
  index: number
) {
  const selected = c.key === selectedKey
  const current = focusedPane(c)
  return {
    kind: 'cell' as const,
    c,
    index,
    selected,
    rows: orderedPanes(c).map((p) => ({
      ...paneRow(src, p, selected && p === current, base),
      favorite: findFavorite(w, p.cwd) !== undefined
    }))
  }
}

function cells(src: RowSource, w: DeepReadonly<Workspace>) {
  const base = labelBase(w)
  return w.cells.map((c, i) => cellGroup(src, w, c, base, i))
}

const favoriteLabel = (favorite: boolean): string =>
  favorite ? 'Remove from Favorites' : 'Add to Favorites'

const groups = computed(() => {
  const src: RowSource = { shown, command, notification, tasks, home, shell }
  return workspaces.map((w) => {
    const f = folded.has(w.key)
    const auto = autoWorkspaceName(w, home)
    const dir = workspaceDir(w)
    const root = dir === undefined ? undefined : dirRow(dir, home)
    const favorites = favoriteRows(w.favorites ?? [], dir, home)
    return {
      w,
      name: w.name ?? auto,
      auto,
      folded: f,
      kept: !!w.kept,
      ...workspaceMarks(f, f ? urgent.get(w.key) : undefined, f && unread.has(w.key)),
      root,
      favorites,
      line: f || !w.kept ? undefined : root,
      items: f ? [] : cells(src, w)
    }
  })
})

// `groups` 밖에서 센다. `groups` 안에서 세면 `now` 가 바뀔 때마다 모든 cell 의 줄을 다시 만들기 때문이다.
function jobTime(j: JobRow): string {
  if (j.exited) return 'exited'
  return j.started === undefined ? '' : elapsed(now - j.started)
}

function openRow(e: MouseEvent, workspace: number, dir: string): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const width = anchorWidth(r.width, nav.value!.getBoundingClientRect().width)
  emit('openDir', workspace, dir, { left: r.left, top: r.top, bottom: r.bottom, width })
}

const heads = new Map<number, HTMLElement>()
function headRef(key: number, el: unknown): void {
  if (el instanceof HTMLElement) heads.set(key, el)
  else heads.delete(key)
}

const dirCards = new Map<number, HTMLElement>()
function dirCardRef(key: number, el: unknown): void {
  if (el instanceof HTMLElement) dirCards.set(key, el)
  else dirCards.delete(key)
}
const favoritesFor = ref<number | null>(null)

let menu: InstanceType<typeof WorkspaceMenu> | null = null
function menuRef(el: unknown): void {
  menu = el as InstanceType<typeof WorkspaceMenu> | null
}
function toggleMenu(key: number): void {
  if (menuFor === key) menu?.close()
  else emit('openMenu', key)
}

const hovered = shallowRef<{ at: CardAt; el: HTMLElement }>()

const sidebarCard: TooltipCard<CardAt> = {
  id: SIDEBAR_CARD_ID,
  show(el, at) {
    if (keepsCardAt(hovered.value?.at, at)) return
    hovered.value = { at, el }
  },
  hide() {
    hovered.value = undefined
  }
}

const cellTip = (cell: number, row?: string) => ({
  card: sidebarCard,
  at: { kind: 'cell' as const, cell, row }
})

// 돈 시간이 들어가므로 `groups` 밖에서 만든다.
const cardView = computed((): CardView | undefined => {
  const at = hovered.value?.at
  if (!at) return undefined
  if (at.kind === 'cell') {
    const item = groups.value.flatMap((g) => g.items).find((i) => i.c.key === at.cell)
    return (
      item &&
      cellCard(
        item.rows,
        jobs.filter((j) => j.cell === item.c.id),
        now
      )
    )
  }
  const g = groups.value.find((g) => g.w.key === at.workspace)
  if (!g) return undefined
  if (at.kind === 'dir') return g.line && dirCard(g.line)
  return workspaceCard({
    name: g.name,
    auto: g.auto,
    dir: g.root?.path,
    states: g.w.cells.flatMap((c) => orderedPanes(c).map((p) => shown(p.ptyId)?.state)),
    cells: g.w.cells.length,
    jobs: g.w.cells.reduce((n, c) => n + (jobsByCell.value.get(c.id)?.length ?? 0), 0)
  })
})

const cardAnchor = computed(() => {
  const h = hovered.value
  if (!h) return undefined
  if (h.at.kind === 'cell') return h.el.closest<HTMLElement>('.group') ?? h.el
  return h.el
})

const cardCurrent = computed(() => {
  const at = hovered.value?.at
  return at?.kind === 'cell' ? at.row : undefined
})

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
        const dir = el.querySelector(':scope > .dir-card')
        return {
          ...spanOf(el),
          key,
          head: spanOf(el.querySelector(':scope > .workspace-head')!),
          count: w?.cells.length ?? 0,
          cells: Array.from(el.querySelectorAll(':scope > .group'), spanOf),
          folded: folded.has(key),
          dirBottom: dir ? spanOf(dir).bottom : undefined
        }
      }
    ),
    newWorkspace: slot ? spanOf(slot) : undefined
  }
}

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
const keepTip = (kept: boolean): string =>
  kept ? 'Keep Workspace' : 'Keep Workspace — keep it in the sidebar after its last cell closes'
</script>

<template>
  <nav ref="nav" class="sidebar window-drag" :class="{ collapsed }">
    <div class="titlebar" />
    <div ref="list" v-overlay-scroll="'y'" class="list">
      <div
        v-for="(
          { w, name, folded: wf, kept, state, notified, dot, favorites, line, items: entries }, wi
        ) in groups"
        :key="w.key"
        class="workspace"
        :class="{ dragging: workspaceDragged(w.key) }"
        :data-workspace="w.key"
      >
        <button
          :ref="(el) => headRef(w.key, el)"
          v-tooltip="{ card: sidebarCard, at: { kind: 'head', workspace: w.key } }"
          class="workspace-head"
          :class="{ folded: wf, 'menu-open': menuFor === w.key }"
          :aria-label="wf ? `Expand ${name}` : `Collapse ${name}`"
          :aria-expanded="!wf"
          @mousedown.prevent
          @pointerdown="grabWorkspace($event, w.key, wi)"
          @click="emit('fold', w.key)"
        >
          <span v-if="state" class="state status-icon" :class="[state, { unread: notified }]"
            ><StatusIcon :state="state"
          /></span>
          <span class="workspace-name workspace-title">{{ name }}</span>
          <span v-if="dot" class="unread-dot" />
          <!-- workspace 헤더가 button 이라 그 안에 button 을 넣지 못한다. keep 버튼과 메뉴 버튼의 pointerdown·click 이 헤더의 끌기·접기로 전해지지 않게 막는다. -->
          <span class="keep-slot" :class="{ on: kept }"
            ><span
              v-tooltip="keepTip(kept)"
              role="button"
              class="keep icon-button"
              aria-label="Keep Workspace"
              :aria-pressed="kept"
              @pointerdown.stop
              @click.stop="emit('toggleKeep', w.key)"
              ><AnchorIcon class="text-icon" /></span
          ></span>
          <span
            v-tooltip="menuFor === w.key ? undefined : 'Workspace Menu'"
            role="button"
            class="workspace-menu-button icon-button"
            aria-label="Workspace Menu"
            aria-haspopup="menu"
            :aria-expanded="menuFor === w.key"
            @pointerdown.stop
            @click.stop="toggleMenu(w.key)"
            ><EllipsisVertical class="text-icon"
          /></span>
          <FoldChevron class="chevron" :open="!wf" />
        </button>
        <WorkspaceMenu
          v-if="menuFor === w.key && heads.get(w.key)"
          :ref="menuRef"
          :name="name"
          :kept="kept"
          :head="heads.get(w.key)!"
          @done="(n, refocus) => emit('closeMenu', w.key, n, refocus)"
          @toggle-keep="emit('toggleKeep', w.key)"
          @close-workspace="emit('closeWorkspace', w.key)"
        />
        <div v-if="line" :ref="(el) => dirCardRef(w.key, el)" class="dir-card">
          <button
            v-tooltip="{ card: sidebarCard, at: { kind: 'dir', workspace: w.key } }"
            class="row dir-row"
            :aria-label="`Open ${line.name}`"
            @mousedown.prevent
            @click="openRow($event, w.key, line.dir)"
          >
            <span class="state"><LeadIcon name="folder-root" /></span>
            <span class="title">{{ line.path }}</span>
          </button>
          <button
            v-if="favorites.length"
            v-tooltip="favoritesFor === w.key ? undefined : 'Favorites'"
            class="more"
            :aria-label="`${favorites.length} Favorites`"
            aria-haspopup="menu"
            :aria-expanded="favoritesFor === w.key"
            @mousedown.prevent
            @click="favoritesFor = favoritesFor === w.key ? null : w.key"
          >
            +{{ favorites.length }}
          </button>
        </div>
        <FavoritesMenu
          v-if="favoritesFor === w.key && favorites.length && dirCards.get(w.key)"
          :favorites="favorites"
          :card="dirCards.get(w.key)!"
          @close="favoritesFor = null"
          @open="(dir, at) => emit('openDir', w.key, dir, at)"
          @remove="(dir) => emit('removeFavorite', w.key, dir)"
        />
        <div
          v-for="item in entries"
          :key="item.c.key"
          v-tooltip="cellTip(item.c.key)"
          class="group"
          :class="{ selected: item.selected, dragging: cellDragged(item.c.key) }"
        >
          <span
            class="grip"
            aria-hidden="true"
            @mousedown.prevent
            @pointerdown="grabCell($event, w.key, item.c.key, item.index)"
          />
          <div v-for="r in item.rows" :key="r.pane" class="pane-line">
            <button
              v-tooltip="cellTip(item.c.key, `pane:${r.pane}`)"
              class="row pane-row"
              :class="[r.tone, { shell: !r.state, focused: r.focused }]"
              :aria-label="r.aria"
              @mousedown.prevent
              @click="emit('focus', item.c.key, r.pane)"
            >
              <span class="state status-icon" :class="{ unread: r.notice }"
                ><PaneIcon :icon="r.icon"
              /></span>
              <span class="title">{{ r.text }}</span>
              <PanePlace v-if="r.place" class="tail" :place="r.place" />
              <span v-else-if="r.command && r.commandTail" class="tail command-tail">{{
                commandTail(r.command, now)
              }}</span>
            </button>
            <button
              v-if="r.path"
              v-tooltip="kept ? favoriteLabel(r.favorite) : 'Keep Workspace to add favorites'"
              class="favorite"
              :class="{ on: r.favorite }"
              :aria-label="favoriteLabel(r.favorite)"
              :aria-pressed="r.favorite"
              :aria-disabled="!kept"
              @mousedown.prevent
              @click="kept && emit('toggleFavorite', item.c.key, r.pane)"
            >
              <Star class="text-icon" :fill="r.favorite ? 'currentColor' : 'none'" />
            </button>
          </div>
          <div
            v-for="j in jobsByCell.get(item.c.id)"
            :key="j.pty"
            v-tooltip="cellTip(item.c.key, `job:${j.pty}`)"
            class="row job-row"
            :class="{ exited: j.exited }"
          >
            <span class="state"><LeadIcon name="gear" /></span>
            <span class="title">{{ j.text }}</span>
            <span v-if="j.ports" class="tail ports">{{ j.ports }}</span>
            <span class="tail time">{{ jobTime(j) }}</span>
            <button
              v-tooltip="j.exited ? 'Remove' : 'Stop'"
              class="tail kill"
              :aria-label="j.exited ? `Remove ${j.text}` : `Stop ${j.text}`"
              @mousedown.prevent
              @click="emit('killJob', j.pty)"
            >
              <X class="text-icon" />
            </button>
          </div>
        </div>
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
    <SidebarCard
      :view="cardView"
      :current="cardCurrent"
      :anchor="cardAnchor"
      :side="nav ?? undefined"
    />
  </nav>
</template>

<style scoped>
/* 접은 사이드바는 폭을 줄이고 행 끝의 칸을 숨길 뿐이라, 아이콘과 글자의 x 와 행의 높이는 펼친 판과 같다.
   행 앞 칸의 아이콘과 workspace 이름의 첫 글자는 신호등의 첫 원과 같은 x(12px)에 선다. 12px 는 cell 면의 바깥 여백
   6px 와 안쪽 여백 6px 를 더한 값이다. */
.sidebar {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  --row-height: 30px;
  background: var(--side);
  font:
    var(--text-3) var(--font-ui),
    sans-serif;
}

.titlebar {
  flex: none;
  height: var(--titlebar-height);
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

/* 라이브러리가 그린 세로 스크롤바는 사이드바의 `drag` 를 물려받고 DOM 에서 cell 뒤에 붙는다. drag 영역은 z-index 와
   상관없이 DOM 에서 뒤의 것이 앞의 것을 덮으므로, 그대로 두면 스크롤바 띠가 그 밑의 별을 창 끌기 영역으로 덮는다.
   스크롤바는 누르는 컨트롤이라 no-drag 로 둔다. */
.list > :deep(.os-scrollbar-vertical) {
  -webkit-app-region: no-drag;
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

.workspace-head .chevron {
  flex: none;
  margin-left: calc(-1 * var(--space-2));
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
}

.keep-slot {
  flex: none;
  align-self: stretch;
  display: flex;
  align-items: center;
}

/* keep 을 끈 workspace 의 keep 버튼은 hover·focus 때만 보이므로 이름 폭을 줄이지 않는다. 접은 사이드바에서
   이름이 버튼 폭만큼 더 잘리지 않게 하기 위해서다. 버튼의 자리는 이름보다 먼저 0 까지 준다. 자리가 줄면 버튼은 자리의 오른쪽
   끝에 붙은 채 왼쪽으로 넘쳐 이름 끝 글자를 가린다. 이름 뒤에 빈 폭이 있으면 버튼은 이름 뒤에 선다. 자리의 왼쪽 margin 은
   헤더의 gap 을 빼고, 버튼의 왼쪽 margin 이 그 gap 을 버튼 앞에 다시 둔다. */
.keep-slot:not(.on) {
  flex: 0 1000 auto;
  min-width: 0;
  justify-content: flex-end;
  margin-left: calc(-1 * var(--space-4));
}

.keep-slot:not(.on) .keep {
  flex: none;
  margin-left: var(--space-4);
  background-color: var(--side);
  visibility: hidden;
}

.workspace-head:hover .keep,
.workspace-head:focus-visible .keep,
.workspace-head.menu-open .keep {
  visibility: visible;
}

.keep-slot.on .keep {
  color: var(--fg);
}

/* 메뉴 버튼은 헤더를 가리킬 때와 메뉴가 열려 있을 때만 보인다. keep 버튼과 달리 자리를 늘 차지해 이름이 hover 때 밀리지 않는다. */
.workspace-menu-button {
  flex: none;
  margin-left: auto;
  visibility: hidden;
}

.workspace-head:hover .workspace-menu-button,
.workspace-head:focus-visible .workspace-menu-button,
.workspace-head.menu-open .workspace-menu-button {
  visibility: visible;
}

.workspace-head.menu-open .workspace-menu-button {
  color: var(--fg);
}

/* 이름 위에 겹친 keep 버튼은 바탕색으로 이름을 가리므로, hover 색은 `.icon-button` 처럼 바탕색을 바꾸지 않고 그 위에 덧칠한다. */
.keep:hover {
  background-color: transparent;
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
.dir-card:last-child {
  margin-bottom: 0;
}

.group,
.dir-card {
  position: relative;
  margin: 0 var(--space-3) var(--space-3);
  border-radius: var(--radius-2);
}

.grip + .pane-line > .row,
.dir-row {
  border-top-left-radius: var(--radius-2);
  border-top-right-radius: var(--radius-2);
}

.group > .row:last-child,
.group > .pane-line:last-child > .row,
.dir-row {
  border-bottom-left-radius: var(--radius-2);
  border-bottom-right-radius: var(--radius-2);
}

.group {
  background: color-mix(in srgb, var(--fg) 4%, transparent);
}

.group.selected {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}

.row.dir-row {
  color: var(--faint);
}

/* 테두리 대신 안쪽으로 그은 outline 이라 박스 높이가 열린 cell 과 같다. */
.dir-card {
  outline: 1px dashed color-mix(in srgb, var(--fg) 18%, transparent);
  outline-offset: -1px;
}

.dir-row:hover {
  background: var(--hover);
}

/* 디렉토리 줄 위 오른쪽 끝에 얹는다. 줄의 글자가 그 밑으로 가지 않게 줄의 오른쪽을 비운다. */
.dir-card:has(.more) > .dir-row {
  padding-right: calc(var(--space-3) + 28px);
}

.more {
  position: absolute;
  top: 50%;
  right: var(--space-2);
  min-width: 24px;
  justify-content: center;
  height: 20px;
  padding: 0 var(--space-2);
  transform: translateY(-50%);
  border-radius: var(--radius-1);
  color: var(--faint);
}

.more:hover,
.more[aria-expanded='true'] {
  background: var(--hover);
  color: var(--muted);
}

.pane-line {
  position: relative;
  display: flex;
  align-items: center;
}

/* `.kill` 처럼 키보드로도 닿게 display 대신 opacity 로 숨긴다. */
.favorite {
  position: absolute;
  right: var(--space-3);
  width: 16px;
  height: 16px;
  justify-content: center;
  border-radius: var(--radius-1);
  color: var(--faint);
  font-size: 12px;
  opacity: 0;
}

.pane-line:hover .favorite,
.favorite:focus-visible {
  opacity: 1;
}

.favorite.on,
.favorite:not([aria-disabled='true']):hover {
  color: var(--fg);
}

.favorite[aria-disabled='true']:hover {
  background-color: transparent;
}

.pane-line:has(.favorite):hover .tail {
  display: none;
}

.pane-line:has(.favorite):hover > .pane-row {
  padding-right: calc(var(--space-3) + 16px + var(--space-2));
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
.pane-line:hover > .pane-row,
.group:not(.dragging) > .grip:hover + .pane-line > .pane-row:not(.focused) {
  background: var(--hover);
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

.tail.place {
  flex: 0 1 auto;
  max-width: 60%;
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
