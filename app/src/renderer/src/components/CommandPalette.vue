<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { available, filterCommands, type CommandId } from '../../../shared/commands'
import { commandKeys, formatKeys } from '../../../shared/shortcuts'
import type { Position } from '../config/layout'

const { position } = defineProps<{ position: Position }>()
const emit = defineEmits<{ run: [id: CommandId]; close: [] }>()

const input = useTemplateRef<HTMLInputElement>('input')
const query = ref('')
const index = ref(0)
const matches = computed(() =>
  filterCommands(query.value)
    .filter((c) => available(c, window.maru))
    .map((c) => ({ ...c, keys: commandKeys(c.id) }))
)
watch(query, () => (index.value = 0))

const list = useTemplateRef<HTMLUListElement>('list')
watch(index, () =>
  nextTick(() => list.value?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }))
)

const focus = (): void => input.value?.focus()
defineExpose({ focus })
onMounted(focus)

// 키는 입력창만 받으므로 포커스가 입력창을 떠나면 닫는다. 창이 포커스를 잃을 때도 입력창에 blur 가
// 오는데, 그때는 닫지 않고 창이 돌아왔을 때 포커스가 입력창을 떠나 있으면 닫는다.
function onBlur(): void {
  if (document.hasFocus()) emit('close')
}
function onWindowFocus(): void {
  if (document.activeElement !== input.value) emit('close')
}
onMounted(() => window.addEventListener('focus', onWindowFocus))
onUnmounted(() => window.removeEventListener('focus', onWindowFocus))

// 화살표는 화면 방향대로 움직인다. 팔레트가 아래면 후보가 입력줄 위에 첫 후보부터 위로 놓이므로 ↓ 가 앞 후보다.
function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  const n = matches.value.length
  const down = position === 'bottom' ? -1 : 1
  if (e.key === 'ArrowDown' && n) index.value = (index.value + down + n) % n
  else if (e.key === 'ArrowUp' && n) index.value = (index.value - down + n) % n
  else if (e.key === 'Enter' && n) emit('run', matches.value[index.value].id)
  else if (e.key === 'Escape') emit('close')
  else return
  e.preventDefault()
}
</script>

<template>
  <div class="backdrop" :class="position" @mousedown.self.prevent="emit('close')">
    <div class="palette" @mousedown="(e) => e.target !== input && e.preventDefault()">
      <input
        ref="input"
        v-model="query"
        class="query"
        placeholder="Type a command"
        spellcheck="false"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <ul ref="list" class="list">
        <li
          v-for="(c, i) in matches"
          :key="c.id"
          class="item"
          :class="{ selected: i === index }"
          @mousemove="index = i"
          @click="emit('run', c.id)"
        >
          <span>{{ c.title }}</span>
          <kbd v-if="c.keys">{{ formatKeys(c.keys) }}</kbd>
        </li>
        <li v-if="!matches.length" class="empty">No matching commands</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* 사이드바와 Canvas 헤더의 drag 영역은 그 위에 덮인 요소와 상관없이 클릭을 창 끌기로 가져가므로,
   팔레트를 no-drag 로 둔다. */
.backdrop {
  -webkit-app-region: no-drag;
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
}

.bottom {
  justify-content: flex-end;
}

.palette {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(500px, calc(100% - 32px));
  max-height: calc(100% - 16px);
  margin: 8px auto;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--raised);
  box-shadow: 0 4px 16px rgb(0 0 0 / 50%);
  color: var(--fg);
  font:
    13px system-ui,
    sans-serif;
}

.query {
  flex: none;
  box-sizing: border-box;
  width: calc(100% - 12px);
  margin: 6px;
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  outline: none;
  background: var(--ground);
  color: inherit;
  font: inherit;
}

.query:focus {
  border-color: var(--accent);
}

.list {
  min-height: 0;
  margin: 0;
  padding: 0 0 4px;
  overflow-y: auto;
  list-style: none;
}

.bottom .palette,
.bottom .list {
  display: flex;
  flex-direction: column-reverse;
}

.bottom .list {
  padding: 4px 0 0;
}

.item,
.empty {
  display: flex;
  justify-content: space-between;
  padding: 4px 12px;
}

.item {
  cursor: pointer;
}

.item.selected {
  background: var(--selected);
}

kbd {
  font: inherit;
  color: var(--muted);
}

.empty {
  color: var(--muted);
}
</style>
