<script setup lang="ts">
import { computed, type DeepReadonly } from 'vue'
import type { ClaudeState } from '../../../shared/claude'
import { ICONS, STATE_LABELS } from '../icons'
import { tildePath, windowTitle, workspaceLabel } from '../workspace/cwd'
import { focusedPane, type Pane, type Workspace } from '../workspace/store'

const {
  workspaces,
  selectedKey,
  state,
  urgent,
  folded,
  collapsed,
  home = undefined
} = defineProps<{
  workspaces: readonly DeepReadonly<Workspace>[]
  selectedKey: number | null
  state: (session?: string) => ClaudeState | undefined
  urgent: ReadonlyMap<number, ClaudeState>
  folded: ReadonlySet<number>
  collapsed: boolean
  home?: string
}>()

const emit = defineEmits<{
  select: [workspace: number]
  focus: [workspace: number, pane: number]
  fold: [workspace: number]
}>()

type Row = {
  key: number | 'summary'
  pane?: number
  state?: ClaudeState
  focused: boolean
  text: string
  aria: string
}

function paneRow(p: DeepReadonly<Pane>, s: ClaudeState | undefined, focused: boolean): Row {
  const text = p.title || (s ? 'Claude' : 'Shell')
  return {
    key: p.key,
    pane: p.key,
    state: s,
    focused,
    text,
    aria: s ? `${STATE_LABELS[s]}: ${text}` : text
  }
}

function summaryRow(w: DeepReadonly<Workspace>): Row {
  const claude = w.panes.filter((p) => state(p.sessionId)).length
  const counts: [number, string][] = [
    [claude, 'Claude'],
    [w.panes.length - claude, 'Shell']
  ]
  const text = counts
    .filter(([n]) => n)
    .map(([n, what]) => `${what} ${n}`)
    .join(' · ')
  return { key: 'summary', state: urgent.get(w.key), focused: false, text, aria: `Expand: ${text}` }
}

const groups = computed(() =>
  workspaces.map((w) => {
    const selected = w.key === selectedKey
    const current = focusedPane(w)
    const label = workspaceLabel(current)
    const title = windowTitle(label)
    const f = folded.has(w.key)
    return {
      w,
      selected,
      label,
      tip: current.cwd ? `${title}\n${tildePath(current.cwd, home)}` : title,
      folded: f,
      rows: f
        ? [summaryRow(w)]
        : w.panes.map((p) => paneRow(p, state(p.sessionId), selected && p === current))
    }
  })
)

function press(workspace: number, row: Row): void {
  if (row.pane === undefined) emit('fold', workspace)
  else emit('focus', workspace, row.pane)
}
</script>

<template>
  <nav class="sidebar" :class="{ collapsed }">
    <div class="titlebar" />
    <div class="list">
      <div
        v-for="{ w, selected, label, tip, folded: f, rows } in groups"
        :key="w.key"
        class="group"
        :class="{ selected }"
      >
        <div class="head">
          <button
            class="workspace"
            :title="tip"
            :aria-label="tip"
            @mousedown.prevent
            @click="emit('select', w.key)"
          >
            <span class="name">{{ label.name }}</span>
            <span v-if="label.branch" class="branch"
              >{{ ICONS.branch }}<span class="branch-name">{{ label.branch }}</span></span
            >
          </button>
          <button
            class="fold"
            :aria-label="f ? 'Expand' : 'Collapse'"
            :aria-expanded="!f"
            @mousedown.prevent
            @click="emit('fold', w.key)"
          >
            {{ f ? ICONS.collapsed : ICONS.expanded }}
          </button>
        </div>
        <button
          v-for="r in rows"
          :key="r.key"
          class="row"
          :class="[
            r.pane === undefined ? 'summary' : 'pane-row',
            r.state ?? 'shell',
            { focused: r.focused }
          ]"
          :title="r.aria"
          :aria-label="r.aria"
          @mousedown.prevent
          @click="press(w.key, r)"
        >
          <span class="state status-icon" :title="r.state && STATE_LABELS[r.state]">{{
            r.state ? ICONS[r.state] : ICONS.terminal
          }}</span>
          <span class="title fade">{{ r.text }}</span>
          <span v-if="r.state && r.pane !== undefined" class="app fade">{{ ICONS.claude }}</span>
        </button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  -webkit-app-region: drag;
  flex: 1;
  min-width: 0;
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

.titlebar {
  flex: none;
  height: 36px;
  border-bottom: 1px solid var(--line);
}

.list {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.group {
  padding: 4px 0;
}

.group + .group {
  border-top: 1px solid var(--line);
}

button {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.head:hover,
.row:hover {
  background: var(--hover);
}

.head {
  display: flex;
}

.workspace {
  flex: 1;
  min-width: 0;
  gap: 6px;
  padding: 0 4px 0 12px;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  color: var(--faint);
}

.selected .name {
  color: var(--fg);
}

.branch {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  font-size: 11px;
  color: var(--faint);
}

.branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.fold {
  flex: none;
  justify-content: center;
  width: 24px;
  color: var(--faint);
  font-size: 11px;
  opacity: 0;
}

.head:hover .fold,
.fold:focus-visible {
  opacity: 1;
}

/* 상태 아이콘(14px)의 가운데를 접은 사이드바(--rail)의 가운데에 맞춰, 접고 펴도 아이콘이 제자리에 남는다. */
.row {
  width: 100%;
  gap: 8px;
  padding: 0 10px 0 calc(var(--rail) / 2 - 7px);
  box-sizing: border-box;
  font-size: 12px;
}

.state {
  flex: none;
  width: 14px;
  text-align: center;
  color: var(--claude, var(--faint));
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app {
  flex: none;
  color: var(--faint);
}

.pane-row.idle .title,
.summary .title {
  color: var(--faint);
}

.row.waiting {
  background: color-mix(in srgb, var(--waiting) 14%, transparent);
}

.pane-row.waiting .title {
  color: var(--fg);
  font-weight: 600;
}

.pane-row.focused {
  background: var(--selected);
}

.pane-row.focused .title {
  color: var(--fg);
}

.fade {
  transition: opacity 100ms linear;
}

.collapsed .fade {
  opacity: 0;
}

.collapsed .workspace {
  justify-content: center;
  padding: 0 6px;
}

.collapsed .name {
  font-size: 10.5px;
}

.collapsed .branch,
.collapsed .fold {
  display: none;
}
</style>
