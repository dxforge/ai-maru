<script setup lang="ts">
import { computed, type DeepReadonly } from 'vue'
import type { ClaudeState } from '../../../shared/claude'
import { ICONS, STATE_LABELS } from '../icons'
import { windowTitle, workspaceLabel } from '../workspace/cwd'
import { focusedPane, type Pane, type Workspace } from '../workspace/store'

const { workspaces, selectedKey, state, urgent, folded } = defineProps<{
  workspaces: readonly DeepReadonly<Workspace>[]
  selectedKey: number | null
  state: (session?: string) => ClaudeState | undefined
  urgent: ReadonlyMap<number, ClaudeState>
  folded: ReadonlySet<number>
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
    const f = folded.has(w.key)
    const label = workspaceLabel(current)
    return {
      w,
      selected,
      name: label.name,
      title: windowTitle(label),
      summary: f ? urgent.get(w.key) : undefined,
      claude: f ? [] : claude
    }
  })
)
</script>

<template>
  <nav class="rail">
    <div class="titlebar" />
    <div class="list">
      <div
        v-for="{ w, selected, name, title, summary, claude } in groups"
        :key="w.key"
        class="group"
        :class="{ selected }"
        :title="title"
        @mousedown.prevent
        @click="emit('select', w.key)"
      >
        <div class="icons">
          <span v-if="summary" class="icon status-icon" :class="summary">{{ ICONS[summary] }}</span>
          <span v-else-if="!claude.length" class="icon">{{ ICONS.terminal }}</span>
          <button
            v-for="{ p, state: s, focused } in claude"
            :key="p.key"
            class="icon pane-row"
            :class="[s, { focused }]"
            :title="`${STATE_LABELS[s]}: ${p.title || 'Claude'}`"
            :aria-label="`${STATE_LABELS[s]}: ${p.title || 'Claude'}`"
            @click.stop="emit('focus', w.key, p.key)"
          >
            <span class="status-icon">{{ ICONS[s] }}</span>
          </button>
        </div>
        <button class="workspace" :aria-label="title">{{ name }}</button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.rail {
  -webkit-app-region: drag;
  box-sizing: border-box;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
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
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px 8px;
  overflow-y: auto;
}

.group {
  -webkit-app-region: no-drag;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 4px 4px;
  border-radius: 8px;
  cursor: pointer;
}

.group:hover {
  background: var(--hover);
}

.group.selected {
  background: var(--raised);
}

.icons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2px;
}

.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--faint);
}

.status-icon {
  color: var(--claude);
}

button {
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: none;
  font: inherit;
  cursor: pointer;
}

.pane-row:hover {
  background: var(--hover);
}

.waiting {
  border-radius: 5px;
  background: color-mix(in srgb, var(--waiting) 16%, transparent);
}

.pane-row.focused {
  background: var(--selected);
}

.workspace {
  max-width: 100%;
  overflow: hidden;
  color: var(--muted);
  font-size: 10.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.selected .workspace {
  color: var(--fg);
  font-weight: 600;
}
</style>
