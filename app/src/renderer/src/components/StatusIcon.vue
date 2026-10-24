<script setup lang="ts">
import type { ProgramStatusState } from '../../../shared/program-status'

const { state } = defineProps<{ state: ProgramStatusState }>()
</script>

<template>
  <svg
    class="status-svg"
    :class="{ spin: state === 'working' }"
    :data-state="state"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    aria-hidden="true"
  >
    <circle v-if="state === 'idle'" cx="8" cy="8" r="2.5" fill="currentColor" />
    <template v-else-if="state === 'working'">
      <circle
        cx="8"
        cy="8"
        r="5.5"
        fill="none"
        stroke="currentColor"
        stroke-opacity=".3"
        stroke-width="1.1"
      />
      <path
        d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
    </template>
    <template v-else>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.1" />
      <path
        v-if="state === 'done'"
        d="M5.3 8.2l1.9 1.9 3.5-3.7"
        fill="none"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <template v-else-if="state === 'blocked'">
        <path
          d="M8 4.9v3.6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
        <circle cx="8" cy="10.9" r=".8" fill="currentColor" />
      </template>
      <path
        v-else-if="state === 'error'"
        d="M6 6l4 4M10 6l-4 4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
      />
    </template>
  </svg>
</template>

<style scoped>
.status-svg {
  display: block;
  width: 1em;
  height: 1em;
}

/* 상자가 viewBox 와 같은 정사각형이므로 기본 transform-origin(상자 가운데)이 원의 중심 (8, 8) 이다. */
.spin {
  animation: status-spin 1s cubic-bezier(0.53, 0.21, 0.29, 0.67) infinite;
}

@keyframes status-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
