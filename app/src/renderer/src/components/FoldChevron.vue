<script setup lang="ts">
const { open } = defineProps<{ open: boolean }>()
</script>

<template>
  <!-- 아이콘 글꼴의 chevron-right 글리프(U+EAB6)는 11px 에서 중심이 글자 칸 가운데에서 0.7px 남짓 비켜 있다.
       그래서 90도 돌리면 화살표의 자리가 움직이므로, 중심이 viewBox 가운데에 오는 SVG 를 쓴다. -->
  <svg class="chevron" :class="{ open }" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.75 3.5 10.25 8 5.75 12.5" />
  </svg>
</template>

<style scoped>
.chevron {
  flex: none;
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.15s ease;
}

.open {
  transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
  .chevron {
    transition: none;
  }
}
</style>
