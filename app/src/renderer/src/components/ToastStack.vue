<script setup lang="ts">
import { ICONS } from '../icons'
import type { ToastEntry } from '../toast/store'

const { toasts, width } = defineProps<{ toasts: readonly ToastEntry[]; width: number }>()
const emit = defineEmits<{ close: [id: string]; act: [id: string] }>()
</script>

<template>
  <div v-if="toasts.length" class="toast-stack" :style="{ width: `${width}px` }">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.level" role="status">
      <span class="icon nerd-icon">{{ ICONS[t.level] }}</span>
      <div v-overlay-scroll="'y'" class="body">
        <div class="title">{{ t.title }}</div>
        <div v-for="(line, i) in t.lines" :key="i" class="line">{{ line }}</div>
        <div v-if="t.detail" class="detail">{{ t.detail }}</div>
        <button v-if="t.action" class="action" @click="emit('act', t.id)">
          {{ t.action.label }}
        </button>
      </div>
      <button class="close nerd-icon" aria-label="Dismiss" @click="emit('close', t.id)">
        {{ ICONS.close }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 사이드바 위에 뜨므로, 사이드바의 drag 영역이 클릭을 창 끌기로 가져가지 않게 no-drag 로 둔다. */
.toast-stack {
  -webkit-app-region: no-drag;
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.toast {
  display: flex;
  gap: var(--space-5);
  align-items: flex-start;
  padding: var(--space-5) var(--space-4) var(--space-5) var(--space-5);
  border: 1px solid var(--line);
  border-radius: var(--radius-2);
  background: var(--raised);
  box-shadow: 0 4px 16px rgb(0 0 0 / 50%);
  color: var(--fg);
  font: var(--text-3)/1.45 var(--font-ui);
  overflow-wrap: anywhere;
}

.icon {
  flex: none;
  font-size: 16px;
  line-height: 19px;
}

.error .icon {
  color: var(--error);
}

.warning .icon {
  color: var(--waiting);
}

.info .icon {
  color: var(--muted);
}

/* 줄이 많아도 닫기 버튼이 창 밖으로 나가지 않게 내용만 스크롤한다. 80px 는 토스트의 위아래 padding·border 와
   창 아래 여백을 더한 값보다 넉넉히 잡은 값이다. */
.body {
  flex: 1;
  min-width: 0;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.title {
  font-weight: 600;
}

.line,
.detail {
  color: var(--muted);
}

.detail {
  font:
    var(--text-2) var(--font-mono),
    monospace;
}

.close {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-1);
  background: transparent;
  color: var(--muted);
  font-size: 14px;
}

.close:hover {
  background: var(--hover);
  color: var(--fg);
}

.action {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-weight: 600;
}

.action:hover {
  text-decoration: underline;
}
</style>
