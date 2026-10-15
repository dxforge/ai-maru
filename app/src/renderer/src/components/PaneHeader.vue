<script setup lang="ts">
import type { ClaudeState } from '../../../shared/claude'
import { ICONS, STATE_LABELS } from '../icons'
import { workspaceName } from '../workspace/cwd'
import type { Pane } from '../workspace/store'

// 제목은 여기서 읽어, 제목이 바뀌면 이 머리만 다시 그린다.
const {
  state = undefined,
  pane,
  focused
} = defineProps<{ state?: ClaudeState; pane: Pick<Pane, 'title' | 'cwd'>; focused: boolean }>()
</script>

<template>
  <div class="row-bar pane-header" :class="[state, { focused }]">
    <span class="row-bar-icon status-icon" :title="state && STATE_LABELS[state]">{{
      state ? ICONS[state] : ICONS.terminal
    }}</span>
    <span class="row-bar-text title">{{ pane.title || 'Shell' }}</span>
    <span v-if="state" class="claude-icon">{{ ICONS.claude }}</span>
    <span v-if="pane.cwd" class="cwd">{{ workspaceName(pane.cwd) }}</span>
  </div>
</template>

<style scoped>
.title {
  flex: 1;
}

.claude-icon,
.cwd {
  color: var(--faint);
}
</style>
