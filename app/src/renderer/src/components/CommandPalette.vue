<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { available, filterCommands, type CommandId } from '../../../shared/commands'
import { commandKeys, formatKeys } from '../../../shared/shortcuts'
import type { Position } from '../config/layout'
import { arrowIndex, closeOnFocusLoss, revealSelected } from './palette'

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
revealSelected(useTemplateRef<HTMLUListElement>('list'), index)

const focus = (): void => input.value?.focus()
defineExpose({ focus })
onMounted(focus)
const onBlur = closeOnFocusLoss(input, () => emit('close'))

function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  const n = matches.value.length
  const moved = arrowIndex(e.key, index.value, n, position)
  if (moved !== undefined) index.value = moved
  else if (e.key === 'Enter' && n) emit('run', matches.value[index.value].id)
  // Tab 을 브라우저에 맡기면 포커스가 사이드바의 버튼으로 옮겨 가, 닫으며 돌려준 터미널의 포커스를 빼앗는다.
  else if (e.key === 'Escape' || e.key === 'Tab') emit('close')
  else return
  e.preventDefault()
}
</script>

<template>
  <div class="palette-backdrop" :class="position" @mousedown.self.prevent="emit('close')">
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
