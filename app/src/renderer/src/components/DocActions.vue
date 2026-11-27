<script setup lang="ts">
// Canvas 문서 제목 줄의 복사·저장 버튼. 누른 일이 끝나면 그 버튼이 잠깐 ✓ 로 바뀐다. 실패는 console 에만 남긴다.
import { Check, Copy, Download } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'
import { copyOf, fileOf, type CanvasEntry } from '../canvas/store'

const DONE_MS = 1500

const { doc } = defineProps<{ doc: CanvasEntry }>()

const done = ref<'copy' | 'save'>()
let timer: ReturnType<typeof setTimeout> | undefined

function show(what: 'copy' | 'save'): void {
  clearTimeout(timer)
  done.value = what
  timer = setTimeout(() => (done.value = undefined), DONE_MS)
}

async function copy(): Promise<void> {
  const content = copyOf(doc)
  if (!content) return
  try {
    await window.maru.copyDoc(content.text, content.html)
  } catch (e) {
    return console.error('maru: cannot copy the document:', e)
  }
  show('copy')
}

async function save(): Promise<void> {
  try {
    const file = await fileOf(doc)
    if (file && (await window.maru.saveDoc(file.name, file.data))) show('save')
  } catch (e) {
    console.error('maru: cannot save the document:', e)
  }
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <!-- 이미지 문서는 복사하지 않는다. 그림 복사는 그림의 확대·축소 막대에 있다. -->
  <button
    v-if="doc.kind !== 'image'"
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
