<script setup lang="ts">
import { ICONS } from '../icons'
import type { ToastEntry } from '../toast/store'

const { toasts, corner, width } = defineProps<{
  toasts: readonly ToastEntry[]
  corner: 'bottom-left' | 'top-right'
  width: number
}>()
const emit = defineEmits<{ close: [id: string] }>()
</script>

<template>
  <div v-if="toasts.length" class="toast-stack" :class="corner" :style="{ width: `${width}px` }">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.level" role="status">
      <span class="icon nerd-icon">{{ ICONS[t.level] }}</span>
      <div class="body">
        <div class="title">{{ t.title }}</div>
        <div v-for="(line, i) in t.lines" :key="i" class="line">{{ line }}</div>
        <div v-if="t.detail" class="detail">{{ t.detail }}</div>
      </div>
      <button class="close nerd-icon" aria-label="Dismiss" @click="emit('close', t.id)">
        {{ ICONS.close }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 사이드바나 Canvas 헤더 위에 뜨므로, 그 drag 영역이 클릭을 창 끌기로 가져가지 않게 no-drag 로 둔다. */
.toast-stack {
  -webkit-app-region: no-drag;
  position: absolute;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bottom-left {
  left: 12px;
  bottom: 12px;
}

.top-right {
  top: 12px;
  right: 12px;
}

.toast {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 8px 12px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--raised);
  box-shadow: 0 4px 16px rgb(0 0 0 / 50%);
  color: var(--fg);
  font: 13px/1.45 system-ui;
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

/* 줄이 많아도 닫기 버튼이 창 밖으로 나가지 않게 내용만 스크롤한다. 80px 는 토스트의 위아래 padding(22px)·border(2px)와
   창 아래 12px 를 더한 36px 보다 크게 잡은 값이다. */
.body {
  flex: 1;
  min-width: 0;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
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
    12px ui-monospace,
    monospace;
}

.close {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
}

.close:hover {
  background: var(--hover);
  color: var(--fg);
}
</style>
