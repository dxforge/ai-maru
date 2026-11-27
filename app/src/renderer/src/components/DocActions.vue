<script setup lang="ts">
import { Check, Copy, Download } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'
import { canCopy, copyOf, fileOf, type CanvasEntry } from '../canvas/store'
import { COPIED_MS } from '../canvas/zoomBox'

const { doc } = defineProps<{ doc: CanvasEntry }>()

const done = ref<'copy' | 'save'>()
let timer: ReturnType<typeof setTimeout> | undefined

function show(what: 'copy' | 'save'): void {
  clearTimeout(timer)
  done.value = what
  timer = setTimeout(() => (done.value = undefined), COPIED_MS)
}

async function act(what: 'copy' | 'save', run: () => Promise<boolean>): Promise<void> {
  try {
    if (await run()) show(what)
  } catch (e) {
    console.error(`maru: cannot ${what} the document:`, e)
  }
}

const copy = () =>
  act('copy', async () => {
    const content = await copyOf(doc)
    if (!content) return false
    await window.maru.copyDoc(content.text, content.html)
    return true
  })

const save = () =>
  act('save', async () => {
    const file = await fileOf(doc)
    return file !== undefined && (await window.maru.saveDoc(file.name, file.data))
  })

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button
    v-if="canCopy(doc)"
    v-tooltip="'Copy'"
    class="copy"
    :class="{ done: done === 'copy' }"
    aria-label="Copy"
    @mousedown.prevent
    @click="copy"
  >
    <Check v-if="done === 'copy'" class="text-icon" />
    <Copy v-else class="text-icon" />
  </button>
  <button
    v-tooltip="'Save…'"
    class="save"
    :class="{ done: done === 'save' }"
    aria-label="Save…"
    @mousedown.prevent
    @click="save"
  >
    <Check v-if="done === 'save'" class="text-icon" />
    <Download v-else class="text-icon" />
  </button>
</template>

<style scoped>
button {
  flex: none;
  width: 22px;
  height: 100%;
  padding: 0;
  font: inherit;
  color: var(--faint);
  background: none;
  border: none;
  cursor: pointer;
}

button:hover {
  color: var(--fg);
}
</style>
