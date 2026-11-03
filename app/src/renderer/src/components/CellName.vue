<script setup lang="ts">
import type { CellName } from '../canvas/store'

const { name = undefined, workspace = false } = defineProps<{
  name?: CellName
  /** workspace 묶음 밖에서 그릴 때 앞에 workspace 이름을 붙인다. */
  workspace?: boolean
}>()
</script>

<!-- 부분 사이는 flex 의 gap 으로 띄운다. 템플릿의 줄바꿈 공백은 Vue 컴파일러가 지운다. -->
<template>
  <span v-if="!name" class="cell-name">—</span>
  <span v-else class="cell-name">
    <span v-if="workspace" class="workspace">{{ name.workspace }} ·</span>
    <span class="cell">{{ name.cell.name }}</span>
    <span v-if="name.cell.branch" class="branch">{{ name.cell.branch }}</span>
  </span>
</template>

<style scoped>
.cell-name {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-3);
  white-space: nowrap;
}

.cell,
.branch {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace {
  flex: none;
}

.workspace,
.branch {
  color: var(--faint);
}
</style>
