<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { Anchor as AnchorIcon, Check, Folder, FolderRoot, X } from '@lucide/vue'
import { nameOnFocusLoss } from '../../../shared/names'
import type { Anchor } from '../launcher/anchor'
import type { DirRow } from '../workspace/sidebarRows'

const {
  name,
  base = undefined,
  favorites,
  kept,
  head
} = defineProps<{
  name: string
  /** workspace 의 디렉토리(`workspaceDir`)다. Favorites 맨 위에 지울 수 없는 줄로 둔다. */
  base?: DirRow
  favorites: readonly DirRow[]
  kept: boolean
  /** 메뉴를 연 workspace 헤더. 메뉴는 그 안의 ⋮ 버튼 아래에 오른쪽 끝을 맞춰 뜬다. */
  head: HTMLElement
}>()

const emit = defineEmits<{
  /** `name` 이 null 이면 이름을 바꾸지 않는다. `refocus` 면 터미널에 포커스를 돌려준다. */
  done: [name: string | null, refocus: boolean]
  openFavorite: [dir: string, anchor: Anchor]
  removeFavorite: [dir: string]
  toggleKeep: []
  closeWorkspace: []
}>()

const rows = computed(() => [
  ...(base ? [{ ...base, base: true }] : []),
  ...favorites.map((f) => ({ ...f, base: false }))
])

const GAP = 4
const MARGIN = 8
const WIDTH = 260
const MIN_WIDTH = 180
const root = useTemplateRef<HTMLElement>('root')
const input = useTemplateRef<HTMLInputElement>('input')
const at = ref({ left: 0, top: 0, width: WIDTH })
let opened = ''
let finished = false

function finish(next: string | null, refocus: boolean): void {
  if (finished) return
  finished = true
  emit('done', next, refocus)
}

// Enter 가 아닌 경우에 닫는다. 닫힌 뒤에 오는 이벤트에서는 입력창이 이미 없다.
function close(refocus: boolean): void {
  if (!finished) finish(nameOnFocusLoss(input.value!.value, opened), refocus)
}

// 처음 값은 템플릿에 묶지 않고 여기서 한 번만 준다. 묶으면 자동 이름을 고치는 중에 셸이 cd 해 `name` 이 바뀔 때 Vue 가
// 친 글자를 되돌리기 때문이다.
onMounted(async () => {
  const el = input.value!
  opened = name
  el.value = name
  el.focus()
  el.select()
  document.documentElement.classList.add('window-drag-off')
  document.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('resize', onResize)
  window.addEventListener('focus', onWindowFocus)
  // 오른쪽 끝을 ⋮ 에 맞추고 왼쪽 여백까지만 넓혀 사이드바 안에 둔다.
  const b = (menuButton() ?? head).getBoundingClientRect()
  const width = Math.max(MIN_WIDTH, Math.min(WIDTH, b.right - MARGIN))
  at.value = { left: b.right - width, top: b.bottom + GAP, width }
  await nextTick()
  const r = root.value!.getBoundingClientRect()
  const below = b.bottom + GAP
  const above = b.top - GAP - r.height
  const top = below + r.height <= innerHeight - MARGIN || above < MARGIN ? below : above
  at.value = {
    left: Math.max(MARGIN, Math.min(b.right - width, innerWidth - MARGIN - width)),
    top: Math.max(MARGIN, Math.min(top, innerHeight - MARGIN - r.height)),
    width
  }
})
onBeforeUnmount(() => {
  document.documentElement.classList.remove('window-drag-off')
  document.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('focus', onWindowFocus)
})

const menuButton = (): Element | null => head.querySelector('.workspace-menu-button')

// 메뉴를 여닫는 헤더의 ⋮ 버튼은 스스로 메뉴를 닫으므로 여기서 닫지 않는다.
function onPointerDown(e: PointerEvent): void {
  const t = e.target as Element | null
  if (t && (root.value?.contains(t) || menuButton()?.contains(t))) return
  close(true)
}

// 창 크기가 바뀌면 헤더가 움직여 메뉴가 ⋮ 버튼에서 떨어진다.
function onResize(): void {
  close(true)
}

// 창이 포커스를 잃을 때도 focusout 이 오는데, 그때는 닫지 않고 창이 돌아왔을 때 포커스가 메뉴 밖이면 닫는다.
function onFocusOut(e: FocusEvent): void {
  if (!document.hasFocus()) return
  const next = e.relatedTarget as Node | null
  if (!next || !root.value?.contains(next)) close(false)
}

// 제목·안내 문구·구분선·여백은 포커스를 받지 않는다. 그 자리를 누르면 포커스가 body 로 가 `onFocusOut` 이 메뉴를 닫으므로,
// 이름 칸이 아닌 곳을 누를 때는 기본 동작을 막는다.
function onMouseDown(e: MouseEvent): void {
  if (e.target !== input.value) e.preventDefault()
}

function onWindowFocus(): void {
  if (!root.value?.contains(document.activeElement)) close(false)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  if (e.key === 'Enter' && e.target === input.value) finish(input.value!.value, true)
  else if (e.key === 'Escape') finish(null, true)
  else return
  e.preventDefault()
}

defineExpose({ close: () => close(true) })

function act(run: () => void): void {
  close(true)
  run()
}

// 메뉴는 닫히므로 런처는 메뉴가 있던 자리에 메뉴의 폭으로 띄운다.
function openFavorite(dir: string): void {
  const r = root.value!.getBoundingClientRect()
  act(() => emit('openFavorite', dir, { left: r.left, top: r.top, bottom: r.top, width: r.width }))
}
</script>

<template>
  <div
    ref="root"
    class="workspace-menu popup-menu"
    role="menu"
    :style="{ left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px` }"
    @keydown="onKeydown"
    @mousedown="onMouseDown"
    @focusout="onFocusOut"
  >
    <div class="name-field">
      <input
        ref="input"
        class="workspace-name-input text-input"
        aria-label="Workspace name"
        spellcheck="false"
      />
    </div>
    <hr />
    <div class="section">Favorites</div>
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
        @click="openFavorite(f.dir)"
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
        @click="emit('removeFavorite', f.dir)"
      >
        <X class="icon" />
      </button>
    </div>
    <div v-if="!favorites.length" class="hint">
      {{ kept ? 'Star a pane to add its directory' : 'Keep Workspace to add favorites' }}
    </div>
    <hr />
    <button
      class="action"
      role="menuitemcheckbox"
      :aria-checked="kept"
      @click="act(() => emit('toggleKeep'))"
    >
      <AnchorIcon class="icon" />Keep Workspace<Check v-if="kept" class="icon check" />
    </button>
    <button class="action close-action" role="menuitem" @click="act(() => emit('closeWorkspace'))">
      <X class="icon" />Close Workspace
    </button>
  </div>
</template>

<style scoped>
.workspace-menu {
  -webkit-app-region: no-drag;
  position: fixed;
  z-index: 9;
  box-sizing: border-box;
  max-height: calc(100vh - 16px);
  text-transform: none;
  letter-spacing: normal;
  font-weight: normal;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

.name-field {
  padding: 0 var(--space-3) var(--space-1);
}

.workspace-name-input {
  width: 100%;
}

.section {
  padding: var(--space-1) var(--space-5);
  color: var(--faint);
  font-size: var(--text-1);
}

.hint {
  padding: var(--space-2) var(--space-5);
  color: var(--faint);
}

.popup-menu .action,
.popup-menu .favorite-open {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.favorite-item {
  display: flex;
  align-items: center;
}

.favorite-item:hover {
  background: var(--hover);
}

.popup-menu .favorite-open {
  flex: 1;
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

/* 다른 즐겨찾기 줄과 글자 끝을 맞추려고 보이지 않는 X 자리를 둔다. */
.remove-slot {
  visibility: hidden;
}

.icon {
  flex: none;
  width: 12px;
  height: 12px;
  color: var(--muted);
}

.check {
  margin-left: auto;
}
</style>
