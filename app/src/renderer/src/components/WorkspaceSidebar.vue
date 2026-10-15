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
  urgent,
  folded,
  home = undefined
} = defineProps<{
  workspaces: readonly DeepReadonly<Workspace>[]
  selectedKey: number | null
  state: (session?: string) => ClaudeState | undefined
  urgent: ReadonlyMap<number, ClaudeState>
  folded: ReadonlySet<number>
  home?: string
}>()

const emit = defineEmits<{
  select: [workspace: number]
  focus: [workspace: number, pane: number]
  fold: [workspace: number]
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
      folded: folded.has(w.key),
      summary: folded.has(w.key) ? urgent.get(w.key) : undefined,
      claude
    }
  })
)
</script>

<template>
  <nav class="sidebar">
    <div class="titlebar" />
    <div class="list">
      <div
        v-for="{ w, selected, label, path, shells, folded: f, summary, claude } in groups"
        :key="w.key"
        class="group"
        :class="{ selected }"
      >
        <button
          v-if="claude.length"
          class="fold"
          :aria-label="f ? 'Expand' : 'Collapse'"
          :aria-expanded="!f"
          @mousedown.prevent
          @click="emit('fold', w.key)"
        >
          {{ f ? ICONS.collapsed : ICONS.expanded }}
        </button>
        <button class="workspace" @mousedown.prevent @click="emit('select', w.key)">
          <span class="line">
            <span class="name">{{ label.name }}</span>
            <span v-if="label.branch" class="branch"
              >{{ ICONS.branch }}<span class="branch-name">{{ label.branch }}</span></span
            >
            <span v-if="summary" class="summary status-icon" :class="summary">{{
              ICONS[summary]
            }}</span>
            <span v-if="shells" class="shells" :title="`${shells} shell${shells > 1 ? 's' : ''}`"
              ><span>{{ ICONS.terminal }}</span
              >{{ shells }}</span
            >
          </span>
          <span v-if="path" class="path">{{ path }}</span>
        </button>
        <button
          v-for="{ p, state: s, focused } in f ? [] : claude"
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
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  -webkit-app-region: drag;
  flex: none;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--side);
  font:
    13px system-ui,
    'Symbols Nerd Font Mono',
    sans-serif;
}

/* 신호등 버튼 자리. */
.titlebar {
  flex: none;
  height: 36px;
  border-bottom: 1px solid var(--line);
}

.list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px 8px;
  overflow-y: auto;
}

.group {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 3px 0;
  border-radius: 8px;
}

.group.selected {
  background: var(--raised);
}

button {
  -webkit-app-region: no-drag;
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

.fold {
  position: absolute;
  top: 3px;
  left: 6px;
  z-index: 1;
  justify-content: center;
  width: 20px;
  padding: 0;
  color: var(--faint);
  font-size: 11px;
}

.workspace {
  flex-direction: column;
  align-items: stretch;
  height: auto;
  padding: 0 10px 0 28px;
}

.line {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--row);
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
  gap: 4px;
}

.summary,
.shells {
  margin-left: auto;
}

.summary + .shells {
  margin-left: 0;
}

.summary {
  flex: none;
  color: var(--claude);
}

.branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.path {
  height: var(--row);
  line-height: var(--row);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pane-row {
  gap: 8px;
  padding: 0 10px 0 26px;
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
