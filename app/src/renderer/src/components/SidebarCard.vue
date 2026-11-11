<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { GitBranch } from '@lucide/vue'
import { placeBeside } from '../tooltip'
import LeadIcon from './LeadIcon.vue'
import PaneIcon from './PaneIcon.vue'
import StatusIcon from './StatusIcon.vue'
import { SIDEBAR_CARD_ID, type CardView } from '../workspace/sidebarCard'

/**
 * 카드의 위 끝을 `anchor` 의 위 끝에 맞추고, `side`(사이드바)의 오른쪽 끝을 `OVERLAP` 만큼 덮게 띄운다. `current` 는
 * 강조할 구역의 key 다.
 */
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

/** 카드가 사이드바 오른쪽 끝을 덮는 폭(px) */
const OVERLAP = 8

// 내용이 바뀌면 높이도 바뀌므로, prop 이 바뀔 때마다 크기를 다시 재어 자리를 잡는다. 카드가 떠 있는 동안 사이드바를
// 스크롤하면 `vTooltip` 이 카드를 닫는다. 그래서 스크롤로 기준 요소가 옮겨 가는 것은 따라가지 않는다.
function place(): void {
  const el = card.value
  if (!el) return
  const open = el.matches(':popover-open')
  if (!view || !anchor || !side) {
    if (open) el.hidePopover()
    return
  }
  if (!open) el.showPopover()
  // 창 오른쪽 끝에 있던 카드는 남은 폭만큼 좁아져 있으므로, 왼쪽 위로 옮겨 제 크기로 잰다.
  el.style.left = '0px'
  el.style.top = '0px'
  el.style.maxHeight = ''
  const size = el.getBoundingClientRect()
  const at = placeBeside(
    { top: anchor.getBoundingClientRect().top, left: side.getBoundingClientRect().right - OVERLAP },
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
          <div class="head">
            <span v-if="s.icon" class="icon" :class="s.tone"
              ><LeadIcon v-if="s.icon === 'job'" name="gear" /><PaneIcon v-else :icon="s.icon"
            /></span>
            <span class="name">{{ s.title }}</span>
          </div>
          <div class="body" :class="{ indent: s.icon }">
            <div v-if="s.notice" class="notice">{{ s.notice }}</div>
            <div v-if="s.note" class="note">{{ s.note }}</div>
            <div v-if="s.message" class="message">{{ s.message }}</div>
            <div v-if="s.command" class="command" :class="{ failed: !s.command.running }">
              {{ s.command.text }}
            </div>
            <div v-if="s.run" class="run">{{ s.run }}</div>
            <div v-if="s.time" class="time">{{ s.time }}</div>
            <div v-if="s.path || s.git" class="where">
              <div v-if="s.path" class="path">{{ s.path }}</div>
              <div v-if="s.git" class="git with-icon">
                <GitBranch class="text-icon" />{{ s.git }}
              </div>
            </div>
          </div>
        </section>
        <footer v-if="view.foot" class="foot">
          <div v-if="view.foot.states" class="states">
            <span v-for="f in view.foot.states" :key="f.state" class="with-icon"
              ><span class="icon" :class="f.state"><StatusIcon :state="f.state" /></span
              >{{ f.text }}</span
            >
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
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-5);
}

.section + .section {
  border-top: 1px solid var(--line);
}

.section.current {
  background: var(--hover);
}

.where {
  margin-top: var(--space-2);
  color: var(--muted);
}

.head {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  font-size: var(--text-3);
}

/* 아이콘 칸 폭(14px)은 사이드바 줄의 `.state`(`WorkspaceSidebar.vue`)와 같아야 하고, `.body.indent` 도 이 폭을
   쓴다. */
.icon {
  flex: none;
  align-self: center;
  width: 14px;
  color: var(--claude, var(--faint));
}

.icon :deep(svg) {
  margin: 0 auto;
}

.name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* 아이콘이 있는 구역은 아래 줄을 이름이 시작하는 자리에 맞춘다. */
.body.indent {
  padding-left: calc(14px + var(--space-4));
}

/* 자동 이름(`.note`)과 돈 시간·끝난 까닭(`.time`·`.command`)은 회색으로 두고, 무엇을 하는지(`.message`·`.run`)는
   기본 글자색으로 둔다. */
.note,
.time,
.command {
  color: var(--muted);
}

.command.failed {
  color: var(--error);
}

.with-icon {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.with-icon .text-icon {
  align-self: center;
}

.states {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
  color: var(--fg);
}

.states .icon {
  width: auto;
}

.run {
  white-space: pre-wrap;
  font:
    var(--text-2) / 1.45 var(--font-mono),
    monospace;
}

.foot {
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--line);
  background: var(--side);
  color: var(--muted);
}
</style>
