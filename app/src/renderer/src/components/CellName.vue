<script setup lang="ts">
import type { CellName } from '../canvas/store'

const { name = undefined } = defineProps<{ name?: CellName }>()
</script>

<template>
  <span v-if="!name" class="cell-name">—</span>
  <span v-else class="cell-name"
    ><span class="workspace">{{ name.workspace }} /</span>
    <span class="cell">{{ name.cell.name }}</span
    ><template v-if="name.cell.branch">
      <span class="branch">{{ name.cell.branch }}</span></template
    ></span
  >
</template>

<style scoped>
.workspace,
.branch {
  color: var(--faint);
}
</style>
