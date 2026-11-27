<script setup lang="ts">
import { X } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'
import FoldChevron from './FoldChevron.vue'

const { title, open } = defineProps<{ title: string; open: boolean }>()
const emit = defineEmits<{ open: []; remove: [] }>()
defineSlots<{ meta?(): unknown; actions?(): unknown }>()

// 포인터가 줄에 들어와 버튼이 나타난 뒤 `ARM_MS` 동안은 버튼을 눌러도 무시한다. 나타난 버튼이 시각이 있던 자리를
// 차지해서, 시각을 눌러 접으려고 포인터를 옮겨 바로 누르면 ✕ 가 눌려 문서가 지워지기 때문이다. 키보드 포커스로 나타난
// 버튼은 막지 않는다. 300ms 는 재어 정한 값이 아니다.
const ARM_MS = 300

const ready = ref(true)
let timer: ReturnType<typeof setTimeout> | undefined

function enter(): void {
  clearTimeout(timer)
  ready.value = false
  timer = setTimeout(() => (ready.value = true), ARM_MS)
}

function leave(): void {
  clearTimeout(timer)
  ready.value = true
}

function guard(e: MouseEvent): void {
  if (ready.value) return
  e.stopPropagation()
  e.preventDefault()
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="row" :class="{ open }" @pointerenter="enter" @pointerleave="leave">
    <button class="head" :aria-expanded="open" @mousedown.prevent @click="emit('open')">
      <FoldChevron class="chev" :open="open" />
      <span class="title">{{ title }}</span>
      <span class="meta"><slot name="meta" /></span>
    </button>
    <span class="tools" :class="{ ready }" @click.capture="guard">
      <slot name="actions" />
      <button
        v-tooltip="'Remove'"
        class="remove"
        aria-label="Remove"
        @mousedown.prevent
        @click="emit('remove')"
      >
        <X class="text-icon" />
      </button>
    </span>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: var(--row-h);
  padding-right: var(--space-3);
  background: var(--hdr);
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: var(--text-3);
}

.row:hover {
  background: color-mix(in srgb, var(--hdr), var(--fg) 6%);
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

.head {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 100%;
  padding: 0 var(--space-2) 0 var(--space-5);
  text-align: left;
}

.chev {
  color: var(--faint);
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title {
  font-weight: 500;
}

.open .title {
  color: var(--fg);
}

/* 좁으면 제목이 먼저 줄고, 그다음 메타가 줄어 오른쪽 버튼을 덮지 않는다. 메타 안에서는 시각이 남고 cell 이름이 먼저 줄어든다. */
.meta {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: var(--text-1);
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

/* 버튼은 포인터를 올리거나 포커스가 들어왔을 때만 나타나 메타·제목을 왼쪽으로 민다. 안 보이는 버튼이 자리를 차지하면 시각
   오른쪽이 비어 보이고, 버튼을 메타 위에 겹쳐 띄우면 좁은 폭에서 제목 끝의 말줄임표를 가리기 때문이다. 숨길 때 폭만 0 으로
   두는 것은 Shift+Tab 으로 뒤에서 들어와도 버튼에 포커스가 가게 하기 위해서다(`display: none` 이면 건너뛴다). */
.tools {
  flex: none;
  display: flex;
  align-items: center;
  width: 0;
  height: 100%;
  overflow: hidden;
}

.row:hover .tools,
.row:focus-within .tools {
  width: auto;
}

.remove {
  flex: none;
  width: 18px;
  height: 100%;
  padding: 0;
  font-size: 11px;
  color: var(--faint);
}

.remove:hover {
  color: var(--fg);
}
</style>
