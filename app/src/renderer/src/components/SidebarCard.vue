<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { Clock, GitBranch } from '@lucide/vue'
import { commandClass } from '../icons'
import { placeBeside } from '../tooltip'
import { SIDEBAR_CARD_ID, type CardView } from '../workspace/sidebarCard'

/** `anchor` 의 위 끝과 `side`(사이드바)의 오른쪽 끝에 맞춰 띄운다. `current` 는 강조할 구역의 key 다. */
const {
  view = undefined,
  current = undefined,
  anchor = undefined,
  side = undefined
} = defineProps<{
  view?: CardView
  current?: string
  anchor?: HTMLElement
  side?: HTMLElement
}>()

const card = useTemplateRef<HTMLElement>('card')

// 내용이 바뀌면 높이도 바뀌므로 그릴 때마다 다시 잰다. 카드가 떠 있는 동안 스크롤하면 `vTooltip` 이 카드를 닫으므로
// 기준 요소의 자리는 그동안 바뀌지 않는다.
function place(): void {
  const el = card.value
  if (!el) return
  const open = el.matches(':popover-open')
  if (!view || !anchor || !side) {
    if (open) el.hidePopover()
    return
  }
  if (!open) el.showPopover()
  el.style.maxHeight = ''
  const size = el.getBoundingClientRect()
  const at = placeBeside(
    { top: anchor.getBoundingClientRect().top, right: side.getBoundingClientRect().right },
    size,
    { width: innerWidth, height: innerHeight }
  )
  el.style.left = `${at.left}px`
  el.style.top = `${at.top}px`
  if (at.maxHeight !== undefined) el.style.maxHeight = `${at.maxHeight}px`
}

watch(() => [view, current, anchor, side] as const, place, { flush: 'post' })
onBeforeUnmount(() => {
  if (card.value?.matches(':popover-open')) card.value.hidePopover()
})
</script>

<template>
  <Teleport to="body">
    <div :id="SIDEBAR_CARD_ID" ref="card" popover="manual" role="tooltip" class="sidebar-card">
      <template v-if="view">
        <section
          v-for="s in view.sections"
          :key="s.key"
          class="section"
          :class="{ current: s.key === current }"
          :data-section="s.key"
        >
          <div class="name">{{ s.title }}</div>
          <div v-if="s.notice" class="notice">{{ s.notice }}</div>
          <div v-if="s.note" class="sub note">{{ s.note }}</div>
          <div v-if="s.path" class="sub path">{{ s.path }}</div>
          <div v-if="s.git" class="sub git with-icon">
            <GitBranch class="text-icon" />{{ s.git }}
          </div>
          <div v-if="s.status" class="status" :class="s.status.state">
            <span class="dot" />{{ s.status.text }}
          </div>
          <div v-if="s.status?.message" class="message">{{ s.status.message }}</div>
          <div v-if="s.command" class="status command" :class="commandClass(s.command)">
            <span class="dot" />{{ s.command.text }}
          </div>
          <div v-if="s.run" class="run">{{ s.run }}</div>
          <div v-if="s.time" class="sub time with-icon"><Clock class="text-icon" />{{ s.time }}</div>
        </section>
        <footer v-if="view.foot" class="foot">
          <div v-if="view.foot.states" class="status" :class="view.foot.state">
            <span class="dot" />{{ view.foot.states }}
          </div>
          <div class="counts">{{ view.foot.counts }}</div>
        </footer>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
/* `.tooltip`(`style.css`)처럼 popover 기본 스타일의 가운데 정렬을 풀어 `place` 가 정한 `left`·`top` 에 놓는다. */
.sidebar-card {
  position: fixed;
  inset: auto;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  min-width: 240px;
  max-width: 360px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-3);
  background: var(--raised);
  box-shadow: 0 6px 20px rgb(0 0 0 / 45%);
  color: var(--fg);
  font:
    var(--text-2) / 1.45 var(--font-ui),
    sans-serif;
  overflow-wrap: anywhere;
  pointer-events: none;
  user-select: none;
}

.section {
  padding: var(--space-4) var(--space-5);
}

.section + .section {
  border-top: 1px solid var(--line);
}

.section.current {
  background: var(--hover);
}

.name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: var(--text-3);
  font-weight: 600;
}

.sub,
.message {
  color: var(--muted);
}

.with-icon,
.status {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.with-icon .text-icon {
  flex: none;
  align-self: center;
}

.dot {
  flex: none;
  align-self: center;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--claude, var(--faint));
}

/* 상태 줄의 글자 앞 점(8px)과 틈만큼 들여, 메시지가 상태 이름 아래에서 시작하게 한다. */
.message {
  padding-left: calc(8px + var(--space-2));
}

.run {
  color: var(--muted);
  white-space: pre-wrap;
  font:
    var(--text-1) / 1.45 var(--font-mono),
    monospace;
}

.foot {
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--line);
  background: var(--side);
  color: var(--muted);
}
</style>
