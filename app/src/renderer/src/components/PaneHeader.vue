<script setup lang="ts">
import { computed } from 'vue'
import { dirName } from '../../../shared/names'
import { paneName, type CommandView } from '../../../shared/pane-name'
import type { ProgramStatusRecord } from '../../../shared/program-status'
import type { PtyNotification } from '../../../shared/pty-state'
import { AGENT_ICONS, commandClass, commandIcon, STATE_LABELS } from '../icons'
import StatusIcon from './StatusIcon.vue'
import { commandTail, notificationText } from '../workspace/display'
import type { Pane } from '../workspace/store'

// 제목은 여기서 읽어, 제목이 바뀌면 이 헤더만 다시 그린다.
const {
  status = undefined,
  command = undefined,
  notification = undefined,
  pane,
  focused,
  now,
  shell = undefined
} = defineProps<{
  status?: Pick<ProgramStatusRecord, 'state' | 'app'>
  command?: CommandView
  /** 사용자가 아직 보지 않은 알림 */
  notification?: PtyNotification
  pane: Pick<Pane, 'title' | 'cwd' | 'command'>
  focused: boolean
  /** 명령이 돈 시간을 셀 때 쓰는 현재 시각이다. 도는 명령이 없으면 쓰지 않는다. */
  now: number
  shell?: string
}>()

const state = computed(() => status?.state)
const agent = computed(() => status && AGENT_ICONS.get(status.app))
const tail = computed(() => (command ? commandTail(command, now) : ''))
const notice = computed(() => notification && notificationText(notification))
</script>

<template>
  <div class="row-bar pane-header" :class="[state ?? commandClass(command), { focused }]">
    <span
      class="row-bar-icon status-icon"
      :class="{ 'nerd-icon': !state, unread: notification }"
      :title="state && STATE_LABELS[state]"
      ><StatusIcon v-if="state" :state="state" /><template v-else>{{
        commandIcon(command)
      }}</template></span
    >
    <span class="row-bar-text title">{{ paneName(pane, status, shell, command) }}</span>
    <span v-if="notice" class="row-bar-text notification" :title="notice">{{ notice }}</span>
    <span v-if="tail" class="command-tail">{{ tail }}</span>
    <span v-if="agent" class="claude-icon nerd-icon">{{ agent }}</span>
    <span v-if="pane.cwd" class="cwd">{{ dirName(pane.cwd) }}</span>
  </div>
</template>

<style scoped>
.pane-header {
  --unread-ring: var(--hdr);
}

.pane-header.focused {
  --unread-ring: var(--hdr-focus);
}

/* 아이콘 칸의 오른쪽 끝에서 바로 이름이 시작하므로, 점을 칸 안쪽에 두어 이름 첫 글자에 겹치지 않게 한다. */
.status-icon.unread::after {
  right: 2px;
}

.title {
  flex: 1;
}

/* 자리가 모자라면 알림 글이 pane 이름보다 먼저 줄어든다. pane 이름은 이 pane 을 알아보는 이름이라 남긴다. */
.title:has(+ .notification) {
  flex-basis: auto;
}

.notification {
  flex: 0 1000 auto;
  max-width: 60%;
}

.claude-icon,
.cwd,
.command-tail,
.notification {
  color: var(--faint);
}

.command-failed .command-tail {
  color: var(--error);
}
</style>
