<script setup lang="ts">
import { ICONS } from '../icons'
import FoldChevron from './FoldChevron.vue'

const { title, open } = defineProps<{ title: string; open: boolean }>()
const emit = defineEmits<{ open: []; remove: [] }>()
defineSlots<{ meta?(): unknown }>()
</script>

<template>
  <div class="row" :class="{ open }">
    <button class="head" :aria-expanded="open" @mousedown.prevent @click="emit('open')">
      <FoldChevron class="chev" :open="open" />
      <span class="title">{{ title }}</span>
      <span class="meta"><slot name="meta" /></span>
    </button>
    <button class="remove" title="Remove" @mousedown.prevent @click="emit('remove')">
      <span class="nerd-icon">{{ ICONS.close }}</span>
    </button>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: var(--row-h);
  padding-right: 6px;
  background: var(--hdr);
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 12.5px;
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
  gap: 6px;
  height: 100%;
  padding: 0 4px 0 10px;
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

.meta {
  flex: none;
  font-size: 11px;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

.remove {
  flex: none;
  width: 18px;
  padding: 0;
  font-size: 11px;
  color: var(--faint);
  opacity: 0;
}

.row:hover .remove {
  opacity: 1;
}

.remove:hover {
  color: var(--fg);
}
</style>
