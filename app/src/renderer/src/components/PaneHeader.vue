<script setup lang="ts">
import { computed } from 'vue'
import { dirName } from '../../../shared/names'
import type { ProgramStatusRecord } from '../../../shared/program-status'
import { AGENT_ICONS, commandClass, commandIcon, STATE_LABELS } from '../icons'
import StatusIcon from './StatusIcon.vue'
import { commandTail, paneName, type CommandView } from '../workspace/display'
import type { Pane } from '../workspace/store'

// 제목은 여기서 읽어, 제목이 바뀌면 이 헤더만 다시 그린다.
const {
  status = undefined,
  command = undefined,
  pane,
  focused,
  now,
  shell = undefined
} = defineProps<{
  status?: Pick<ProgramStatusRecord, 'state' | 'app'>
  command?: CommandView
  pane: Pick<Pane, 'title' | 'cwd' | 'command'>
  focused: boolean
  /** 명령이 돈 시간을 셀 때 쓰는 현재 시각이다. 도는 명령이 없으면 쓰지 않는다. */
  now: number
  shell?: string
}>()

const state = computed(() => status?.state)
const agent = computed(() => status && AGENT_ICONS.get(status.app))
const tail = computed(() => (command ? commandTail(command, now) : ''))
</script>

<template>
  <div class="row-bar pane-header" :class="[state ?? commandClass(command), { focused }]">
    <span
      class="row-bar-icon status-icon"
      :class="{ 'nerd-icon': !state }"
      :title="state && STATE_LABELS[state]"
      ><StatusIcon v-if="state" :state="state" /><template v-else>{{
        commandIcon(command)
      }}</template></span
    >
    <span class="row-bar-text title">{{ paneName(pane, status, shell, command) }}</span>
    <span v-if="tail" class="command-tail">{{ tail }}</span>
    <span v-if="agent" class="claude-icon nerd-icon">{{ agent }}</span>
    <span v-if="pane.cwd" class="cwd">{{ dirName(pane.cwd) }}</span>
  </div>
</template>

<style scoped>
.title {
  flex: 1;
}

.claude-icon,
.cwd,
.command-tail {
  color: var(--faint);
}

.command-failed .command-tail {
  color: var(--error);
}
</style>
