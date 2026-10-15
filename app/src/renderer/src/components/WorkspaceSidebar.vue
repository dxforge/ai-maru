<script setup lang="ts">
import { computed, type DeepReadonly } from 'vue'
import type { ClaudeState } from '../../../shared/claude'
import { ICONS, STATE_LABELS } from '../icons'
import { tildePath, workspaceLabel } from '../workspace/cwd'
import { focusedPane, type Pane, type Workspace } from '../workspace/store'

const {
  workspaces,
  selectedKey,
  state,
  home = undefined
} = defineProps<{
  workspaces: readonly DeepReadonly<Workspace>[]
  selectedKey: number | null
  state: (session?: string) => ClaudeState | undefined
  home?: string
}>()

const emit = defineEmits<{
  select: [workspace: number]
  focus: [workspace: number, pane: number]
}>()

const groups = computed(() =>
  workspaces.map((w) => {
    const selected = w.key === selectedKey
    const current = focusedPane(w)
    const claude: { p: DeepReadonly<Pane>; state: ClaudeState; focused: boolean }[] = []
    for (const p of w.panes) {
      const s = state(p.sessionId)
      if (s) claude.push({ p, state: s, focused: selected && p === current })
    }
    return {
      w,
      selected,
      label: workspaceLabel(current),
      path: selected && current.cwd ? tildePath(current.cwd, home) : undefined,
      shells: w.panes.length - claude.length,
      claude
    }
  })
)
</script>

<template>
  <nav class="sidebar">
    <div
      v-for="{ w, selected, label, path, shells, claude } in groups"
      :key="w.key"
      class="group"
      :class="{ selected }"
    >
      <button class="workspace" @mousedown.prevent @click="emit('select', w.key)">
        <span class="name">{{ label.name }}</span>
        <span v-if="label.branch" class="branch"
          >{{ ICONS.branch }}<span class="branch-name">{{ label.branch }}</span></span
        >
        <span v-if="shells" class="shells" :title="`${shells} shell${shells > 1 ? 's' : ''}`"
          >{{ ICONS.terminal }}{{ shells }}</span
        >
      </button>
      <div v-if="path" class="path" @mousedown.prevent>{{ path }}</div>
      <button
        v-for="{ p, state: s, focused } in claude"
        :key="p.key"
        class="pane-row"
        :class="[s, { focused }]"
        :aria-label="`${STATE_LABELS[s]}: ${p.title || 'Claude'}`"
        @mousedown.prevent
        @click="emit('focus', w.key, p.key)"
      >
        <span class="state status-icon" :title="STATE_LABELS[s]">{{ ICONS[s] }}</span>
        <span class="title">{{ p.title || 'Claude' }}</span>
        <span class="app">{{ ICONS.claude }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
/* 사이드바는 터미널 영역이 아니라 셀 격자에 맞추지 않는다. 줄 높이만 터미널 한 행을 따른다. */
.sidebar {
  flex: 0 0 280px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-right: 1px solid var(--line);
  background: var(--side);
  overflow-y: auto;
  font:
    13px system-ui,
    'Symbols Nerd Font Mono',
    sans-serif;
}

.group {
  display: flex;
  flex-direction: column;
  padding: 3px 0;
  border-radius: 8px;
}

.group.selected {
  background: var(--raised);
}

button {
  display: flex;
  align-items: center;
  height: var(--row);
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

button:hover {
  background: var(--hover);
}

.workspace {
  gap: 6px;
  padding: 0 10px;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}

.selected .name {
  color: var(--fg);
}

.branch,
.shells,
.path {
  font-size: 11px;
  color: var(--faint);
}

.branch,
.shells {
  display: flex;
  align-items: center;
  gap: 3px;
}

.branch {
  min-width: 0;
}

.shells {
  flex: none;
  margin-left: auto;
}

.branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.path {
  height: var(--row);
  line-height: var(--row);
  padding: 0 10px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pane-row {
  gap: 8px;
  padding: 0 10px 0 18px;
  font-size: 12px;
}

.pane-row.waiting {
  background: color-mix(in srgb, var(--waiting) 16%, transparent);
}

.pane-row.idle {
  color: var(--faint);
}

.pane-row.focused {
  background: var(--selected);
  color: var(--fg);
}

.state {
  flex: none;
  width: 14px;
  text-align: center;
  color: var(--claude);
}

.title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app {
  flex: none;
  color: var(--faint);
}
</style>
