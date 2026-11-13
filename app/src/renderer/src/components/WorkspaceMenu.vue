<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { Bookmark, Check, X } from '@lucide/vue'
import { nameOnFocusLoss } from '../../../shared/names'
import { POPUP_GAP, POPUP_MARGIN, popupTop, usePopupDismiss } from '../popupDismiss'

const { name, kept, head } = defineProps<{
  name: string
  kept: boolean
  /** 메뉴를 연 workspace 헤더. 메뉴는 그 안의 ⋮ 버튼 아래에 오른쪽 끝을 맞춰 뜬다. */
  head: HTMLElement
}>()

const emit = defineEmits<{
  /** `name` 이 null 이면 이름을 바꾸지 않는다. `refocus` 면 터미널에 포커스를 돌려준다. */
  done: [name: string | null, refocus: boolean]
  toggleKeep: []
  closeWorkspace: []
}>()

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
  window.addEventListener('focus', onWindowFocus)
  // 오른쪽 끝을 ⋮ 에 맞추고 왼쪽 여백까지만 넓혀 사이드바 안에 둔다.
  const b = (menuButton() ?? head).getBoundingClientRect()
  const width = Math.max(MIN_WIDTH, Math.min(WIDTH, b.right - POPUP_MARGIN))
  at.value = { left: b.right - width, top: b.bottom + POPUP_GAP, width }
  await nextTick()
  at.value = {
    left: Math.max(POPUP_MARGIN, Math.min(b.right - width, innerWidth - POPUP_MARGIN - width)),
    top: popupTop(b, root.value!.getBoundingClientRect().height),
    width
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocus)
})

const menuButton = (): Element | null => head.querySelector('.workspace-menu-button')

// 메뉴를 여닫는 헤더의 ⋮ 버튼은 스스로 메뉴를 닫으므로 여기서 닫지 않는다.
usePopupDismiss(
  (t) => !!root.value?.contains(t) || !!menuButton()?.contains(t),
  () => close(true)
)

// 창이 포커스를 잃을 때도 focusout 이 오는데, 그때는 닫지 않고 창이 돌아왔을 때 포커스가 메뉴 밖이면 닫는다.
function onFocusOut(e: FocusEvent): void {
  if (!document.hasFocus()) return
  const next = e.relatedTarget as Node | null
  if (!next || !root.value?.contains(next)) close(false)
}

// 구분선·여백은 포커스를 받지 않는다. 그 자리를 누르면 포커스가 body 로 가 `onFocusOut` 이 메뉴를 닫으므로,
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
    <button
      class="action"
      role="menuitemcheckbox"
      :aria-checked="kept"
      @click="act(() => emit('toggleKeep'))"
    >
      <Bookmark class="icon" />Keep Workspace<Check v-if="kept" class="icon check" />
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

.popup-menu .action {
  display: flex;
  align-items: center;
  gap: var(--space-4);
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
