<script setup lang="ts">
import { X } from '@lucide/vue'
import FoldChevron from './FoldChevron.vue'

const { title, open } = defineProps<{ title: string; open: boolean }>()
const emit = defineEmits<{ open: []; remove: [] }>()
defineSlots<{ meta?(): unknown; actions?(): unknown }>()
</script>

<template>
  <div class="row" :class="{ open }">
    <button class="head" :aria-expanded="open" @mousedown.prevent @click="emit('open')">
      <FoldChevron class="chev" :open="open" />
      <span class="title">{{ title }}</span>
      <span class="meta"><slot name="meta" /></span>
    </button>
    <span v-if="$slots.actions" class="actions"><slot name="actions" /></span>
    <button
      v-tooltip="'Remove'"
      class="remove"
      aria-label="Remove"
      @mousedown.prevent
      @click="emit('remove')"
    >
      <X class="text-icon" />
    </button>
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

/* 좁으면 제목이 먼저 줄고, 그다음 메타가 줄어 오른쪽 버튼을 덮지 않는다. 메타 안에서는 시각을 남기고 cell 이름이 준다. */
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

.actions {
  flex: none;
  display: flex;
  height: 100%;
  opacity: 0;
}

.remove {
  flex: none;
  width: 18px;
  padding: 0;
  font-size: 11px;
  color: var(--faint);
  opacity: 0;
}

.row:hover .actions,
.row:hover .remove {
  opacity: 1;
}

.remove:hover {
  color: var(--fg);
}
</style>
