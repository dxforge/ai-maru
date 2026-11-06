<script setup lang="ts">
import { computed } from 'vue'
import { AGENT_LOGOS } from '../agentLogos'
import type { AgentLogo } from '../icons'

const { agent } = defineProps<{ agent: AgentLogo }>()
const logo = computed(() => AGENT_LOGOS[agent])
</script>

<template>
  <!-- `svgBody` 는 로고 파일의 루트 속성을 버리므로, 루트의 `fill`·`fill-rule` 과 같은 값을 여기 둔다. 세 로고의 path 경계는 viewBox 의 높이 24 를 모두 채우므로(getBBox 로 잼), 1em 상자에 그리면 앞 칸의 상태 아이콘과 높이가 같다. -->
  <!-- eslint-disable vue/no-v-html -- 내용은 의존성 패키지의 svg 파일이다. -->
  <svg
    class="agent-logo"
    :data-icon="agent"
    xmlns="http://www.w3.org/2000/svg"
    :viewBox="logo.viewBox"
    fill="currentColor"
    fill-rule="evenodd"
    aria-hidden="true"
    v-html="logo.body"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>

<style scoped>
.agent-logo {
  display: block;
  flex: none;
  width: 1em;
  height: 1em;
}
</style>
