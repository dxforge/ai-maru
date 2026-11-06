<script setup lang="ts">
import type { PaneIcon } from '../icons'
import AgentLogo from './AgentLogo.vue'
import LeadIcon from './LeadIcon.vue'
import StatusIcon from './StatusIcon.vue'

const { icon } = defineProps<{ icon: PaneIcon }>()
</script>

<template>
  <StatusIcon v-if="'state' in icon" :state="icon.state" />
  <AgentLogo v-else-if="'agent' in icon" :agent="icon.agent" />
  <StatusIcon v-else-if="icon.command === 'failed'" state="error" data-icon="failed" />
  <LeadIcon v-else :name="icon.command" />
</template>
