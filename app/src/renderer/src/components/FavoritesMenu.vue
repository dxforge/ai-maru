<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { Folder, FolderRoot, X } from '@lucide/vue'
import type { Anchor } from '../launcher/anchor'
import { popupTop, usePopupDismiss } from '../popupDismiss'
import type { DirRow } from '../workspace/sidebarRows'

/**
 * 점선 카드의 `+N` 을 누르면 카드의 폭으로 뜨는 즐겨찾기 목록이다. 카드 아래에 뜨고, 아래 자리가 모자라면 위에 뜬다.
 * 아래의 cell 을 밀지 않는다. 터미널의 포커스를 가져가지 않으므로 Esc 는 document 에서 받는다.
 */
const { root, favorites, card, toggle } = defineProps<{
  root: DirRow
  favorites: readonly DirRow[]
  card: HTMLElement
  /** 목록을 여닫는 `+N` 이다. */
  toggle: HTMLElement
}>()

const emit = defineEmits<{
  close: []
  open: [dir: string, anchor: Anchor]
  remove: [dir: string]
}>()

const rows = computed(() => [
  { ...root, base: true },
  ...favorites.map((f) => ({ ...f, base: false }))
])

const menu = useTemplateRef<HTMLElement>('menu')
const at = ref({ left: 0, top: 0, width: 0 })

usePopupDismiss(
  (t) => !!menu.value?.contains(t) || toggle.contains(t),
  () => emit('close')
)

function place(): void {
  const b = card.getBoundingClientRect()
  const height = menu.value!.getBoundingClientRect().height
  at.value = { left: b.left, top: popupTop(b, height), width: b.width }
}

// 카드 위로 뜬 목록에서 즐겨찾기를 빼면 목록이 짧아져 카드와 떨어지므로 자리를 다시 잡는다.
watch(() => favorites.length, place, { flush: 'post' })

// 목록은 화면에 고정돼 있어 사이드바가 스크롤되면 카드와 떨어지므로 닫는다.
function onScroll(e: Event): void {
  if (!menu.value?.contains(e.target as Node)) emit('close')
}

onMounted(() => {
  place()
  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('scroll', onScroll, true)
})
// 목록을 띄운 조건(cell 이 있다, 즐겨찾기가 있다)이 사라져 목록이 unmount 될 때도 열림 상태를 지운다. 지우지 않으면
// 조건이 돌아올 때 누르지 않은 목록이 다시 뜬다.
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  document.removeEventListener('scroll', onScroll, true)
  emit('close')
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.isComposing) return
  e.preventDefault()
  e.stopPropagation()
  emit('close')
}

// 목록은 닫히므로 런처는 목록이 있던 자리에 목록의 폭으로 띄운다.
function open(dir: string): void {
  const r = menu.value!.getBoundingClientRect()
  emit('close')
  emit('open', dir, { left: r.left, top: r.top, bottom: r.top, width: r.width })
}
</script>

<template>
  <div
    ref="menu"
    class="favorites-menu popup-menu"
    role="menu"
    :style="{ left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px` }"
  >
    <div
      v-for="f in rows"
      :key="f.base ? '' : f.dir"
      class="favorite-item"
      :class="{ 'base-item': f.base }"
    >
      <button
        v-tooltip="f.path"
        class="favorite-open"
        role="menuitem"
        :aria-label="`Open ${f.name}`"
        @mousedown.prevent
        @click="open(f.dir)"
      >
        <component :is="f.base ? FolderRoot : Folder" class="icon" /><span class="title">{{
          f.name
        }}</span>
      </button>
      <span v-if="f.base" class="favorite-remove remove-slot icon-button" aria-hidden="true" />
      <button
        v-else
        v-tooltip="'Remove from Favorites'"
        class="favorite-remove icon-button"
        :aria-label="`Remove ${f.name} from Favorites`"
        @mousedown.prevent
        @click="emit('remove', f.dir)"
      >
        <X class="icon" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.favorites-menu {
  -webkit-app-region: no-drag;
  position: fixed;
  z-index: 9;
  box-sizing: border-box;
  max-height: calc(100vh - 16px);
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

.favorite-item {
  display: flex;
  align-items: center;
}

.favorite-item:hover {
  background: var(--hover);
}

.popup-menu .favorite-open {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  padding-right: var(--space-2);
}

.popup-menu .favorite-open:hover {
  background: none;
}

.title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.favorite-remove {
  flex: none;
  margin-right: var(--space-4);
  opacity: 0;
}

/* 다른 즐겨찾기 줄과 글자 끝을 맞추려고 보이지 않는 X 자리를 둔다. */
.remove-slot {
  visibility: hidden;
}

.favorite-item:hover .favorite-remove,
.favorite-remove:focus-visible {
  opacity: 1;
}

.icon {
  flex: none;
  width: 12px;
  height: 12px;
  color: var(--muted);
}
</style>
