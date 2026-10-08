<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import type { CommandId } from '../../shared/commands'
import { createCanvas } from './canvas/store'
import { createClaudeStatuses } from './claude/status'
import CanvasPanel from './components/CanvasPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import TerminalView from './components/TerminalView.vue'
import { columnsWidth } from './workspace/columns'
import { workspaceName } from './workspace/cwd'
import { columnCount, rects, type Layout } from './workspace/layout'
import { createWorkspaces, focusedPane } from './workspace/store'

const canvas = createCanvas()
window.maru.onCanvasPut(canvas.put)

const workspaces = createWorkspaces()

const claude = createClaudeStatuses()
window.maru.onClaudeStatus(claude.set)
void window.maru.claudeStatuses().then(claude.replace)
function newWorkspace(): void {
  const w = workspaces.selected()
  const p = w && focusedPane(w)
  workspaces.open(p?.cwd ?? p?.startDir)
}
workspaces.open()

type Terminal = InstanceType<typeof TerminalView>
const terminals = new Map<number, Terminal>()
function setTerminal(key: number, t: unknown): void {
  if (t) terminals.set(key, t as Terminal)
  else terminals.delete(key)
}

// 보이지 않는 터미널에는 포커스를 줄 수 없어, 선택이 화면에 반영된 뒤에 준다.
async function focusSelected(): Promise<void> {
  await nextTick()
  const w = workspaces.selected()
  if (w) terminals.get(w.focused)?.focus()
}

// 선택이 그대로인 클릭에서는 TerminalView 의 active watch 와 아래의 스크롤 watch 가 돌지 않아,
// 여기서 포커스를 주고 스크롤로 밀려난 칸을 다시 보인다.
function selectWorkspace(key: number): void {
  workspaces.select(key)
  void focusSelected().then(revealFocused)
}

function closePane(): void {
  const w = workspaces.selected()
  if (!w) return
  const pane = w.focused
  terminals.get(pane)?.kill()
  workspaces.closePane(pane)
  void focusSelected()
}

function paneStyles(layout: Layout): Map<number, Record<string, string>> {
  const styles = new Map<number, Record<string, string>>()
  for (const [pane, r] of rects(layout)) {
    const gapX = r.x > 0 ? '1px' : '0px'
    const gapY = r.y > 0 ? '1px' : '0px'
    styles.set(pane, {
      left: `calc(${r.x * 100}% + ${gapX})`,
      top: `calc(${r.y * 100}% + ${gapY})`,
      width: `calc(${r.w * 100}% - ${gapX})`,
      height: `calc(${r.h * 100}% - ${gapY})`
    })
  }
  return styles
}

const viewMode = ref<'single' | 'columns'>('single')
// 모든 터미널이 같은 글꼴을 쓰므로 마지막으로 잰 값 하나로 셈한다.
const cellWidth = ref(0)

const views = computed(() =>
  workspaces.list.value.map((w) => ({
    w,
    focused: focusedPane(w),
    styles: paneStyles(w.layout),
    width:
      viewMode.value === 'columns'
        ? `${columnsWidth(columnCount(w.layout), cellWidth.value)}px`
        : undefined
  }))
)

// columns 에서는 다른 workspace 의 칸도 보여 눌러 포커스를 줄 수 있으므로, 그 workspace 를 선택한다.
function focusPane(workspace: number, pane: number): void {
  workspaces.focusPane(pane)
  workspaces.select(workspace)
}

// workspace 가 화면보다 넓을 수 있어, workspace 가 아니라 포커스된 칸이 보이게 한다.
function revealFocused(): void {
  const w = workspaces.selected()
  if (viewMode.value === 'columns' && w)
    terminals.get(w.focused)?.$el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
// 포커스가 그대로여도 앞의 workspace 가 닫히거나 폭이 바뀌면 칸이 밀려나 views 도 지켜본다.
watch([viewMode, () => workspaces.selected()?.focused, views], revealFocused, { flush: 'post' })

const paletteOpen = ref(false)
const palette = useTemplateRef<InstanceType<typeof CommandPalette>>('palette')

function closePalette(): void {
  if (!paletteOpen.value) return
  paletteOpen.value = false
  void focusSelected()
}

const handlers: Record<CommandId, () => void> = {
  'new-workspace': newWorkspace,
  'split-right': () => workspaces.split('right'),
  'split-down': () => workspaces.split('down'),
  'close-pane': closePane,
  'focus-pane-left': () => workspaces.moveFocus('left'),
  'focus-pane-right': () => workspaces.moveFocus('right'),
  'focus-pane-up': () => workspaces.moveFocus('up'),
  'focus-pane-down': () => workspaces.moveFocus('down'),
  'command-palette': () => {
    paletteOpen.value = true
    palette.value?.focus()
  },
  'toggle-canvas': canvas.toggle,
  'toggle-view-mode': () => {
    viewMode.value = viewMode.value === 'single' ? 'columns' : 'single'
  }
}

function runCommand(id: CommandId): void {
  if (id !== 'command-palette') closePalette()
  handlers[id]()
}
window.maru.onCommand(runCommand)
</script>

<template>
  <div class="app">
    <nav class="sidebar">
      <button
        v-for="{ w, focused } in views"
        :key="w.key"
        class="workspace"
        :class="{ selected: w.key === workspaces.selectedKey.value }"
        @mousedown.prevent
        @click="selectWorkspace(w.key)"
      >
        <span
          v-if="claude.state(focused.sessionId)"
          class="claude-dot"
          :class="claude.state(focused.sessionId)"
          :title="`Claude: ${claude.state(focused.sessionId)}`"
        />{{ workspaceName(focused.cwd) }}
      </button>
    </nav>
    <div class="terminals" :class="viewMode">
      <div
        v-for="{ w, styles, width } in views"
        :key="w.key"
        class="panes"
        :class="{ selected: w.key === workspaces.selectedKey.value }"
        :style="{ width }"
      >
        <div
          v-for="p in w.panes"
          :key="p.key"
          class="pane"
          :class="claude.state(p.sessionId)"
          :style="styles.get(p.key)"
          @focusin="focusPane(w.key, p.key)"
        >
          <TerminalView
            :ref="(t) => setTerminal(p.key, t)"
            :start-dir="p.startDir"
            :active="w.key === workspaces.selectedKey.value && p.key === w.focused"
            @exit="workspaces.closePane(p.key)"
            @spawned="(id) => workspaces.setSessionId(p.key, id)"
            @cwd="(dir) => workspaces.setCwd(p.key, dir)"
            @cell-width="(px) => (cellWidth = px)"
          />
        </div>
      </div>
    </div>
    <CanvasPanel :canvas="canvas" />
    <CommandPalette v-if="paletteOpen" ref="palette" @run="runCommand" @close="closePalette" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100%;
}

.sidebar {
  flex: 0 0 140px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border-right: 1px solid #3c3c3c;
  overflow-y: auto;
}

.workspace {
  padding: 4px 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border: 0;
  border-radius: 4px;
  background: none;
  color: #9d9d9d;
  font:
    13px system-ui,
    sans-serif;
  text-align: left;
  cursor: pointer;
}

.workspace:hover {
  background: #2a2d2e;
}

.workspace.selected {
  background: #37373d;
  color: #d4d4d4;
}

.working {
  --claude: #3794ff;
}

.waiting {
  --claude: #cca700;
}

.idle {
  --claude: #89d185;
}

.claude-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--claude);
  vertical-align: middle;
}

.terminals {
  position: relative;
  flex: 1;
  min-width: 0;
}

/* 보이지 않는 터미널도 자리를 차지해야 창 크기를 따라가고, 보일 때 다시 맞추지 않아도 된다. */
.panes {
  position: absolute;
  inset: 0;
  visibility: hidden;
  background: #3c3c3c;
}

.panes.selected {
  visibility: visible;
}

.columns {
  display: flex;
  /* 스크롤바가 자리를 차지하는 설정에서, 넘치기 시작하거나 그칠 때마다 터미널의 줄 수가 바뀌지 않게. */
  overflow-x: scroll;
}

.columns .panes {
  position: relative;
  flex: none;
  visibility: visible;
}

.columns .panes + .panes {
  border-left: 1px solid #3c3c3c;
}

.pane {
  position: absolute;
  box-sizing: border-box;
  /* 다른 클라이언트가 primary 면 fit 하지 않아, 터미널이 칸보다 넓으면 옆 칸과 패널을 덮는다. */
  overflow: hidden;
  background: #1e1e1e;
  /* 상태가 없어도 자리를 차지해, 상태가 바뀔 때 터미널 크기가 변하지 않게. */
  border-top: 2px solid var(--claude, transparent);
}
</style>
