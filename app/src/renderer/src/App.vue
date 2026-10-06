<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import type { CommandId } from '../../shared/commands'
import { createCanvas } from './canvas/store'
import { createClaudeStatuses } from './claude/status'
import CanvasPanel from './components/CanvasPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import TerminalView from './components/TerminalView.vue'
import { workspaceName } from './workspace/cwd'
import { createWorkspaces } from './workspace/store'

const canvas = createCanvas()
window.maru.onCanvasPut(canvas.put)

const workspaces = createWorkspaces()

const claude = createClaudeStatuses()
window.maru.onClaudeStatus(claude.set)
void window.maru.claudeStatuses().then(claude.replace)
const selectedClaude = computed(() => claude.state(workspaces.selected()?.sessionId))
// 되살리기 전에 띄운 세션은 되살릴 목록에도 들어가 workspace 가 둘 생길 수 있어, 그동안의 ⌘N 은
// 되살린 뒤에 연다.
let pendingNew: number | null = 0
function newWorkspace(): void {
  if (pendingNew === null) {
    const w = workspaces.selected()
    workspaces.open(undefined, w?.cwd ?? w?.startDir)
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

// 보이지 않는 터미널은 포커스를 받지 못하므로 선택이 화면에 반영된 뒤에 준다.
async function focusSelected(): Promise<void> {
  await nextTick()
  const key = workspaces.selectedKey.value
  if (key !== null) terminals.get(key)?.focus()
}

// 선택이 그대로인 클릭에서는 TerminalView 의 active watch 가 돌지 않아 여기서 포커스를 준다.
function selectWorkspace(key: number): void {
  workspaces.select(key)
  void focusSelected()
}

const paletteOpen = ref(false)
const palette = useTemplateRef<InstanceType<typeof CommandPalette>>('palette')

function closePalette(): void {
  if (!paletteOpen.value) return
  paletteOpen.value = false
  void focusSelected()
}

const handlers: Record<CommandId, () => void> = {
  'new-workspace': newWorkspace,
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
        v-for="w in workspaces.list.value"
        :key="w.key"
        class="workspace"
        :class="{ selected: w.key === workspaces.selectedKey.value }"
        @mousedown.prevent
        @click="selectWorkspace(w.key)"
      >
        <span
          v-if="claude.state(w.sessionId)"
          class="claude-dot"
          :class="claude.state(w.sessionId)"
          :title="`Claude: ${claude.state(w.sessionId)}`"
        />{{ workspaceName(w.cwd) }}
      </button>
    </nav>
    <div class="terminals" :class="selectedClaude">
      <TerminalView
        v-for="w in workspaces.list.value"
        :key="w.key"
        :ref="(t) => setTerminal(w.key, t)"
        :session-id="w.sessionId"
        :start-dir="w.startDir"
        :active="w.key === workspaces.selectedKey.value"
        @exit="workspaces.close(w.key)"
        @spawned="(id) => workspaces.setSessionId(w.key, id)"
        @cwd="(dir) => workspaces.setCwd(w.key, dir)"
      />
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
  /* 다른 클라이언트가 primary 면 fit 하지 않아, 터미널이 남은 폭보다 넓으면 패널을 덮는다. */
  overflow: hidden;
  /* 상태가 없어도 자리를 차지해, 상태가 바뀔 때 터미널 크기가 변하지 않게. */
  border-top: 2px solid var(--claude, transparent);
}
</style>
