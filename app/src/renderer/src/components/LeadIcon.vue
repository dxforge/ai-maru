<script setup lang="ts">
import { Play, Settings, SquareTerminal } from '@lucide/vue'

const ICONS = { terminal: SquareTerminal, running: Play, gear: Settings }

// lucide 의 24 격자는 둘레에 여백이 있어, 1em 상자에 그대로 그리면 같은 자리의 상태 아이콘보다 작아 보인다. 13px 글꼴에서
// 15px 로 그렸을 때 잉크가 상태 아이콘과 맞으므로, viewBox 를 가운데의 24×13/15 로 좁혀 1em 상자에서 같은 배율이 되게 한다.
// 선 굵기는 13px 글꼴에서 2×13/20.8 = 1.25px 라, 상태 아이콘의 선 굵기(stroke-width 1.1~1.3, 13px 글꼴에서 약 1.1~1.3px)와 비슷하다.
const VIEW_BOX = '1.6 1.6 20.8 20.8'

const { name } = defineProps<{ name: keyof typeof ICONS }>()
</script>

<!-- 앞 칸(사이드바의 줄 아이콘 칸, pane 헤더의 아이콘 칸)에 그리는 lucide 아이콘이다. -->
<template>
  <component :is="ICONS[name]" class="lead-icon" :data-icon="name" :viewBox="VIEW_BOX" />
</template>

<style scoped>
/* `Settings` 의 위아래 톱니는 선 굵기를 더하면 y 1.0~23.0 까지 닿아 viewBox 밖으로 나가므로, 잘리지 않게 상자 밖에도 그린다. */
.lead-icon {
  display: block;
  width: 1em;
  height: 1em;
  overflow: visible;
}
</style>
