<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue'
import { nameOnFocusLoss } from '../../../shared/names'
import { closeOnFocusLoss } from './palette'

const { value } = defineProps<{ value: string }>()

const emit = defineEmits<{
  /** `name` 이 null 이면 취소다. `refocus` 면 터미널에 포커스를 돌려준다. */
  done: [name: string | null, refocus: boolean]
}>()

const input = useTemplateRef<HTMLInputElement>('input')
// 포커스를 쥔 입력창이 화면에서 빠질 때도 blur 가 온다. 그때는 template ref 가 이미 null 이라 엘리먼트를 따로 잡아 둔다.
let el: HTMLInputElement
let opened = ''
let finished = false

function finish(name: string | null, refocus: boolean): void {
  if (finished) return
  finished = true
  emit('done', name, refocus)
}

let pressedOutside = false
const onBlur = closeOnFocusLoss(input, () =>
  finish(nameOnFocusLoss(el.value, opened), pressedOutside)
)

// 사이드바의 줄은 터미널의 포커스를 지키려고 mousedown 의 기본 동작을 막는다. 그래서 사이드바를 눌러도 입력창이 포커스를
// 잃지 않으므로, 입력창 밖을 누르면 입력창이 스스로 blur 해 포커스를 잃을 때와 같은 규칙(`nameOnFocusLoss`)으로 끝낸다.
// 이때는 터미널에 포커스를 돌려준다. 사이드바 줄은 포커스를 받지 않아, 돌려주지 않으면 포커스가 body 에 남아 키 입력이
// 어디에도 가지 않기 때문이다. 포커스를 받는 곳을 눌렀으면 이어지는 mousedown 이 포커스를 그곳으로 옮기므로 누른 자리를
// 빼앗지 않는다.
function onPointerDown(e: PointerEvent): void {
  if (e.target === el) return
  pressedOutside = true
  el.blur()
}

// 처음 값은 템플릿에 묶지 않고 여기서 한 번만 준다. 묶으면 이 컴포넌트가 다시 그려질 때 Vue 가 친 글자를 처음 값으로
// 되돌리기 때문이다. 자동 이름을 고치는 중에 셸이 cd 하면 `value` 가 바뀌어 다시 그려진다.
onMounted(() => {
  el = input.value!
  opened = value
  el.value = value
  el.focus()
  el.select()
  document.addEventListener('pointerdown', onPointerDown, true)
})
onUnmounted(() => document.removeEventListener('pointerdown', onPointerDown, true))

function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  if (e.key === 'Enter') finish(el.value, true)
  else if (e.key === 'Escape') finish(null, true)
  else return
  e.preventDefault()
}
</script>

<template>
  <input
    ref="input"
    class="workspace-name-input"
    aria-label="Workspace name"
    spellcheck="false"
    @keydown="onKeydown"
    @blur="onBlur"
  />
</template>

<style scoped>
.workspace-name-input {
  -webkit-app-region: no-drag;
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 4px;
  margin-left: -5px;
  box-sizing: border-box;
  border: 1px solid var(--accent);
  border-radius: 4px;
  outline: none;
  background: var(--ground);
  color: var(--fg);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
</style>
