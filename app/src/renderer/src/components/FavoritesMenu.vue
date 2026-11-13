<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { Folder, X } from '@lucide/vue'
import type { Anchor } from '../launcher/anchor'
import type { DirRow } from '../workspace/sidebarRows'

/**
 * 점선 카드의 `+N` 을 누르면 그 카드 바로 아래에 카드의 폭으로 뜨는 즐겨찾기 목록이다. 아래의 cell 을 밀지 않고 그 위에
 * 뜬다. 터미널의 포커스를 가져가지 않으므로 Esc 는 document 에서 받는다.
 */
const { favorites, card } = defineProps<{
  favorites: readonly DirRow[]
  card: HTMLElement
}>()

const emit = defineEmits<{
  close: []
  open: [dir: string, anchor: Anchor]
  remove: [dir: string]
}>()

const GAP = 4
const MARGIN = 8
const root = useTemplateRef<HTMLElement>('root')
const at = ref({ left: 0, top: 0, width: 0 })

onMounted(() => {
  const b = card.getBoundingClientRect()
  const height = root.value!.getBoundingClientRect().height
  const below = b.bottom + GAP
  const top = below + height <= innerHeight - MARGIN ? below : b.top - GAP - height
  at.value = { left: b.left, top: Math.max(MARGIN, top), width: b.width }
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', onResize)
})

// `+N` 은 스스로 목록을 여닫으므로 여기서 닫지 않는다.
function onPointerDown(e: PointerEvent): void {
  const t = e.target as Element | null
  if (t && (root.value?.contains(t) || card.contains(t))) return
  emit('close')
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.isComposing) return
  e.preventDefault()
  e.stopPropagation()
  emit('close')
}

// 창 크기가 바뀌면 점선 카드가 움직여 목록이 카드에서 떨어진다.
function onResize(): void {
  emit('close')
}

// 목록은 닫히므로 런처는 목록이 있던 자리에 목록의 폭으로 띄운다.
function open(dir: string): void {
  const r = root.value!.getBoundingClientRect()
  emit('close')
  emit('open', dir, { left: r.left, top: r.top, bottom: r.top, width: r.width })
}
</script>

<template>
  <div
    ref="root"
    class="favorites-menu popup-menu"
    role="menu"
    :style="{ left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px` }"
  >
    <div v-for="f in favorites" :key="f.dir" class="favorite-item">
      <button
        v-tooltip="f.path"
        class="favorite-open"
        role="menuitem"
        :aria-label="`Open ${f.name}`"
        @mousedown.prevent
        @click="open(f.dir)"
      >
        <Folder class="icon" /><span class="title">{{ f.name }}</span>
      </button>
      <button
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
