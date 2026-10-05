<script setup lang="ts">
import { nextTick } from 'vue'
import { createCanvas } from './canvas/store'
import CanvasPanel from './components/CanvasPanel.vue'
import TerminalView from './components/TerminalView.vue'
import { workspaceName } from './workspace/cwd'
import { createWorkspaces } from './workspace/store'

const canvas = createCanvas()
window.maru.onCanvasPut(canvas.put)

const workspaces = createWorkspaces()
// 되살리기 전에 띄운 세션은 되살릴 목록에도 들어가 workspace 가 둘 생길 수 있어, 그동안의 ⌘N 은
// 되살린 뒤에 연다.
let pendingNew: number | null = 0
window.maru.onNewWorkspace(() => {
  if (pendingNew === null) {
    const w = workspaces.selected()
    workspaces.open(undefined, w?.cwd ?? w?.startDir)
  } else pendingNew++
})
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

// 선택이 그대로인 클릭에서는 TerminalView 의 active watch 가 돌지 않아 여기서 포커스를 준다.
// 보이지 않는 터미널은 포커스를 받지 못하므로 선택이 화면에 반영된 뒤에 준다.
async function selectWorkspace(key: number): Promise<void> {
  workspaces.select(key)
  await nextTick()
  terminals.get(key)?.focus()
}
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
        {{ workspaceName(w.cwd) }}
      </button>
    </nav>
    <div class="terminals">
      <TerminalView
        v-for="w in workspaces.list.value"
        :key="w.key"
        :ref="(t) => setTerminal(w.key, t)"
        :session-id="w.sessionId"
        :start-dir="w.startDir"
        :active="w.key === workspaces.selectedKey.value"
        @exit="workspaces.close(w.key)"
        @cwd="(dir) => workspaces.setCwd(w.key, dir)"
      />
    </div>
    <CanvasPanel :canvas="canvas" />
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

.terminals {
  position: relative;
  flex: 1;
  min-width: 0;
  /* 다른 클라이언트가 primary 면 fit 하지 않아, 터미널이 남은 폭보다 넓으면 패널을 덮는다. */
  overflow: hidden;
}
</style>
