<script setup lang="ts">
import type { CellName } from '../canvas/store'
import PlaceLabel from './PlaceLabel.vue'

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
    <span class="pane-title">{{ name.title }}</span>
    <span v-if="name.more" class="pane-count">+{{ name.more }}</span>
    <PlaceLabel v-if="name.place" class="place" :place="name.place" />
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

.pane-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace,
.pane-count,
.place {
  flex: none;
  color: var(--faint);
}

/* 사이드바 줄처럼 위치는 오른쪽 끝에 붙이고, 줄 폭의 60% 를 넘으면 줄여 pane 이름이 늘 보이게 한다.
   그래서 이 이름을 그리는 쪽이 줄 폭을 정해 줘야 한다. 글자 길이만큼 폭을 잡으면 자기 폭의 60% 가 되어 자리가 남아도 잘린다. */
.place {
  flex: 0 1 auto;
  max-width: 60%;
  margin-left: auto;
}
</style>
