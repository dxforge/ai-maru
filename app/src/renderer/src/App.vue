<script setup lang="ts">
import { createCanvas } from './canvas/store'
import CanvasPanel from './components/CanvasPanel.vue'
import TerminalView from './components/TerminalView.vue'
import { createWorkspaces } from './workspace/store'

const canvas = createCanvas()
window.maru.onCanvasPut(canvas.put)

const workspaces = createWorkspaces()
// 되살리기 전에 띄운 세션은 되살릴 목록에도 들어가 workspace 가 둘 생길 수 있어, 그동안의 ⌘N 은
// 되살린 뒤에 연다.
let pendingNew: number | null = 0
window.maru.onNewWorkspace(() => {
  if (pendingNew === null) workspaces.open()
  else pendingNew++
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
</script>

<template>
  <div class="app">
    <!-- 사이드바의 버튼은 포커스를 가져가지 않는다 — 누른 뒤에도 키 입력은 터미널로 간다. -->
    <nav class="sidebar">
      <button
        v-for="w in workspaces.list.value"
        :key="w.key"
        class="workspace"
        :class="{ selected: w.key === workspaces.selectedKey.value }"
        @mousedown.prevent
        @click="workspaces.select(w.key)"
      >
        Shell
      </button>
    </nav>
    <div class="terminals">
      <TerminalView
        v-for="w in workspaces.list.value"
        :key="w.key"
        :session-id="w.sessionId"
        :active="w.key === workspaces.selectedKey.value"
        @exit="workspaces.close(w.key)"
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
