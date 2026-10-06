<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import type { CommandId } from '../../shared/commands'
import { createCanvas } from './canvas/store'
import { createClaudeStatuses } from './claude/status'
import CanvasPanel from './components/CanvasPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import TerminalView from './components/TerminalView.vue'
import { workspaceName } from './workspace/cwd'
import { rects, type Layout } from './workspace/layout'
import { createWorkspaces, focusedPane } from './workspace/store'

const canvas = createCanvas()
window.maru.onCanvasPut(canvas.put)

const workspaces = createWorkspaces()

const claude = createClaudeStatuses()
window.maru.onClaudeStatus(claude.set)
void window.maru.claudeStatuses().then(claude.replace)
// 되살리기 전에 띄운 세션은 되살릴 목록에도 들어가 workspace 가 둘 생길 수 있어, 그동안의 ⌘N 은
// 되살린 뒤에 연다.
let pendingNew: number | null = 0
function newWorkspace(): void {
  if (pendingNew === null) {
    const w = workspaces.selected()
    const p = w && focusedPane(w)
    workspaces.open(undefined, p?.cwd ?? p?.startDir)
  } else pendingNew++
}
// 거절은 session host 가 답하기 전에 죽었다는 뜻이다. 다시 청하면 새 host 가 답한다.
void window.maru
  .restoreSessions()
  .catch(() => window.maru.restoreSessions())
  .catch(() => [])
  .then((ids) => {
    if (ids.length === 0 && !pendingNew) workspaces.open()
    for (const id of ids) workspaces.open(id)
    for (; pendingNew; pendingNew--) workspaces.open()
    pendingNew = null
  })

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

// 선택이 그대로인 클릭에서는 TerminalView 의 active watch 가 돌지 않아 여기서 포커스를 준다.
function selectWorkspace(key: number): void {
  workspaces.select(key)
  void focusSelected()
}

function closePane(): void {
  const w = workspaces.selected()
  if (!w) return
  const pane = w.focused
  terminals.get(pane)?.kill()
  workspaces.closePane(pane)
  void focusSelected()
}

// 칸 사이의 1px 틈으로 뒤의 배경이 보여 경계가 된다.
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

const views = computed(() =>
  workspaces.list.value.map((w) => ({ w, focused: focusedPane(w), styles: paneStyles(w.layout) }))
)

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
  'toggle-canvas': canvas.toggle
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
    <div class="terminals">
      <div
        v-for="{ w, styles } in views"
        :key="w.key"
        class="panes"
        :class="{ selected: w.key === workspaces.selectedKey.value }"
      >
        <div
          v-for="p in w.panes"
          :key="p.key"
          class="pane"
          :class="claude.state(p.sessionId)"
          :style="styles.get(p.key)"
          @focusin="workspaces.focusPane(p.key)"
        >
          <TerminalView
            :ref="(t) => setTerminal(p.key, t)"
            :session-id="p.sessionId"
            :start-dir="p.startDir"
            :active="w.key === workspaces.selectedKey.value && p.key === w.focused"
            @exit="workspaces.closePane(p.key)"
            @spawned="(id) => workspaces.setSessionId(p.key, id)"
            @cwd="(dir) => workspaces.setCwd(p.key, dir)"
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
