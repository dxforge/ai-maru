<script setup lang="ts">
import { computed } from 'vue'
import { dirName } from '../../../shared/names'
import { CLAUDE_APP, type ProgramStatusRecord } from '../../../shared/program-status'
import { ICONS, STATE_LABELS } from '../icons'
import StatusIcon from './StatusIcon.vue'
import { paneName } from '../workspace/display'
import type { Pane } from '../workspace/store'

// 제목은 여기서 읽어, 제목이 바뀌면 이 헤더만 다시 그린다.
const {
  status = undefined,
  pane,
  focused
} = defineProps<{
  status?: Pick<ProgramStatusRecord, 'state' | 'app'>
  pane: Pick<Pane, 'title' | 'cwd'>
  focused: boolean
}>()

const state = computed(() => status?.state)
</script>

<template>
  <div class="row-bar pane-header" :class="[state, { focused }]">
    <span
      class="row-bar-icon status-icon"
      :class="{ 'nerd-icon': !state }"
      :title="state && STATE_LABELS[state]"
      ><StatusIcon v-if="state" :state="state" /><template v-else>{{
        ICONS.terminal
      }}</template></span
    >
    <span class="row-bar-text title">{{ paneName(pane.title, status) }}</span>
    <span v-if="status?.app === CLAUDE_APP" class="claude-icon nerd-icon">{{ ICONS.claude }}</span>
    <span v-if="pane.cwd" class="cwd">{{ dirName(pane.cwd) }}</span>
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
