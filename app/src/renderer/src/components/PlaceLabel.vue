<script setup lang="ts">
import type { SidebarLabel } from '../../../shared/names'
import { ICONS } from '../icons'

const { place } = defineProps<{ place: SidebarLabel }>()
</script>

<template>
  <span class="place">
    <span v-if="place.name" class="name">{{ place.name }}</span>
    <span v-if="place.branch" class="branch">
      <span class="nerd-icon">{{ ICONS.branch }}</span>
      <span class="branch-name">{{ place.branch }}</span>
    </span>
    <span v-if="place.sub" class="sub">· {{ place.sub }}</span>
  </span>
</template>

<style scoped>
.place {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  font-size: var(--text-1);
}

.name,
.branch-name,
.sub {
  overflow: hidden;
  text-overflow: ellipsis;
}

.name {
  flex: 0 1 auto;
  min-width: 0;
}

.branch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* 저장소 이름이 길어 줄어들어도 branch 아이콘(11px)은 남긴다. */
  min-width: 11px;
}

.branch .nerd-icon {
  flex: none;
}

.sub {
  flex: none;
  max-width: 50%;
}
</style>
