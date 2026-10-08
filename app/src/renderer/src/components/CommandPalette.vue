<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { filterCommands, type CommandId } from '../../../shared/commands'
import { commandKeys, formatKeys } from '../../../shared/shortcuts'

const emit = defineEmits<{ run: [id: CommandId]; close: [] }>()

const input = useTemplateRef<HTMLInputElement>('input')
const query = ref('')
const index = ref(0)
const matches = computed(() =>
  filterCommands(query.value).map((c) => ({ ...c, keys: commandKeys(c.id) }))
)
watch(query, () => (index.value = 0))

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

function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  const n = matches.value.length
  if (e.key === 'ArrowDown' && n) index.value = (index.value + 1) % n
  else if (e.key === 'ArrowUp' && n) index.value = (index.value - 1 + n) % n
  else if (e.key === 'Enter' && n) emit('run', matches.value[index.value].id)
  else if (e.key === 'Escape') emit('close')
  else return
  e.preventDefault()
}
</script>

<template>
  <div class="backdrop" @mousedown.self.prevent="emit('close')">
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
      <ul class="list">
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
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
}

.palette {
  width: min(500px, calc(100% - 32px));
  margin: 8px auto 0;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  background: #252526;
  box-shadow: 0 4px 16px rgb(0 0 0 / 50%);
  color: #d4d4d4;
  font:
    13px system-ui,
    sans-serif;
}

.query {
  box-sizing: border-box;
  width: calc(100% - 12px);
  margin: 6px;
  padding: 4px 6px;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  outline: none;
  background: #1e1e1e;
  color: inherit;
  font: inherit;
}

.query:focus {
  border-color: #0078d4;
}

.list {
  margin: 0;
  padding: 0 0 4px;
  list-style: none;
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
  background: #37373d;
}

kbd {
  font: inherit;
  color: #9d9d9d;
}

.empty {
  color: #9d9d9d;
}
</style>
