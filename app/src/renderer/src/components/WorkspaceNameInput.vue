<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
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

const onBlur = closeOnFocusLoss(input, () => finish(nameOnFocusLoss(el.value, opened), false))

// 처음 값은 템플릿에 묶지 않고 여기서 한 번만 준다. 묶으면 이 컴포넌트가 다시 그려질 때 Vue 가 친 글자를 처음 값으로
// 되돌리기 때문이다. 자동 이름을 고치는 중에 셸이 cd 하면 `value` 가 바뀌어 다시 그려진다.
onMounted(() => {
  el = input.value!
  opened = value
  el.value = value
  el.focus()
  el.select()
})

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
