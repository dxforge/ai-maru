<script setup lang="ts" generic="T extends { id: string; title: string }">
// `CardStream` 은 패널 하나의 목록과 내용을 한 스크롤에 그린다. 항목을 위에서부터 카드로 쌓고, 제목 줄을 누르면
// 펼치거나 접는다. 스크롤해서 화면 밖으로 나간 제목은 위쪽 것은 패널 위에, 아래쪽 것은 패널 아래에 붙고, 붙은 제목을
// 누르면 그 항목으로 간다. 항목이 무엇인지는 모른다 — 쓰는 쪽이 항목과 펼침 상태를 넘기고, 줄의 메타와 본문을 slot
// 으로 채운다.
// 새로 들어온 항목과 같은 id 로 새 객체가 온 항목을 잠깐 강조한다. 그래서 쓰는 쪽은 같은 id 의 항목을 내용이 바뀔
// 때만 새 객체로 넘긴다.
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  useTemplateRef,
  watch
} from 'vue'
import StreamRow from './StreamRow.vue'
import {
  ROW_H,
  anchorScroll,
  computePins,
  fitPins,
  goToScrollTop,
  pinBands,
  type CardBox,
  type Layout,
  type Pins
} from './streamLayout'

const FLASH_MS = 1500

const { items, expanded } = defineProps<{
  items: readonly T[]
  expanded: ReadonlySet<string>
}>()
const emit = defineEmits<{ expand: [id: string, on: boolean]; remove: [id: string] }>()
defineSlots<{
  toolbar?(): unknown
  meta?(props: { item: T }): unknown
  body(props: { item: T }): unknown
}>()

const stage = useTemplateRef<HTMLDivElement>('stage')
const scroller = useTemplateRef<HTMLDivElement>('scroller')
const list = useTemplateRef<HTMLDivElement>('list')

const pins = ref<Pins>({ above: 0, below: 0 })
const bands = computed(() => pinBands(items.length, pins.value))
const pinned = (i: number): boolean => {
  const { above, below } = fitPins(items.length, pins.value)
  return i < above || i >= items.length - below
}

// `offsetTop` 은 정수로 잘린다. 그 값으로 소수 scrollTop 을 맞추면 읽던 내용이 1px 안에서 흔들리므로
// `getBoundingClientRect` 로 잰다.
function cards(): CardBox[] {
  const origin = list.value?.getBoundingClientRect().top ?? 0
  return [...(list.value?.children ?? [])].map((el) => {
    const r = el.getBoundingClientRect()
    return { id: (el as HTMLElement).dataset.id!, top: r.top - origin, height: r.height }
  })
}

// 카드 위치는 스크롤해도 바뀌지 않으므로, 스크롤마다 재지 않고 크기나 항목이 바뀔 때 잰 값을 쓴다.
let tops: number[] = []

function measure(): CardBox[] {
  const now = cards()
  tops = now.map((c) => c.top)
  return now
}

function updatePins(): void {
  const el = scroller.value
  if (!el) return
  const next = computePins(tops, el.scrollTop, el.clientHeight)
  if (next.above !== pins.value.above || next.below !== pins.value.below) pins.value = next
}

// 항목이 들고 나거나 펼침이 바뀌면 바뀌기 전 자리를 재 두었다가, 그린 뒤 읽던 내용이 움직이지 않게 scrollTop 을 맞춘다.
// 누른 제목이 있으면 `place` 가 자리를 정한다.
let before: Layout | null = null
let place: ((before: Layout, after: CardBox[]) => number) | null = null
const shape = (): unknown[] => [items.slice(), [...expanded]]

watch(
  shape,
  () => {
    if (!before && scroller.value) before = { scrollTop: scroller.value.scrollTop, cards: cards() }
  },
  { flush: 'pre' }
)
watch(
  shape,
  () => {
    const el = scroller.value
    const after = measure()
    if (el && before) el.scrollTop = (place ?? anchorScroll)(before, after)
    before = null
    place = null
    updatePins()
  },
  { flush: 'post' }
)

function request(id: string, on: boolean, how: NonNullable<typeof place>): void {
  place = how
  emit('expand', id, on)
  // 쓰는 쪽이 펼침을 바꾸지 않으면 watch 가 돌지 않아 `place` 가 다음 변경에 쓰이므로, 다음 tick 에 지운다.
  void nextTick(() => (place = null))
}

function toggle(id: string): void {
  request(id, !expanded.has(id), (b, a) => anchorScroll(b, a, id))
}

function goTo(id: string): void {
  popover.value = null
  const index = items.findIndex((it) => it.id === id)
  if (index === -1) return
  if (expanded.has(id)) {
    scroller.value!.scrollTop = goToScrollTop(index, tops[index])
    updatePins()
  } else {
    request(id, true, (_, after) => goToScrollTop(index, after[index].top))
  }
}

const flashing = reactive(new Set<string>())
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let known = new Map(items.map((it) => [it.id, it]))

watch(
  () => items.slice(),
  (now) => {
    for (const it of now) if (known.get(it.id) !== it) flash(it.id)
    known = new Map(now.map((it) => [it.id, it]))
  }
)

function flash(id: string): void {
  clearTimeout(timers.get(id))
  flashing.add(id)
  timers.set(
    id,
    setTimeout(() => {
      flashing.delete(id)
      timers.delete(id)
    }, FLASH_MS)
  )
}

const popover = ref<'top' | 'bottom' | null>(null)
const popoverItems = computed(() =>
  popover.value ? bands.value[popover.value].more.map((i) => items[i]) : []
)
watch(popoverItems, (now) => {
  if (!now.length) popover.value = null
})

function onScroll(): void {
  popover.value = null
  updatePins()
}

function closeOutside(e: PointerEvent): void {
  const t = e.target as Element | null
  if (!(t && stage.value?.contains(t) && t.closest('.popover, .more'))) popover.value = null
}

let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(() => {
    measure()
    updatePins()
  })
  observer.observe(scroller.value!)
  observer.observe(list.value!)
  document.addEventListener('pointerdown', closeOutside, true)
  measure()
  updatePins()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('pointerdown', closeOutside, true)
  for (const t of timers.values()) clearTimeout(t)
})
</script>

<template>
  <div class="stream" :style="{ '--row-h': `${ROW_H}px` }">
    <slot name="toolbar" />
    <div ref="stage" class="stage">
      <div ref="scroller" class="scroll" @scroll="onScroll">
        <div ref="list" class="cards">
          <section v-for="(item, i) in items" :key="item.id" class="card" :data-id="item.id">
            <StreamRow
              :title="item.title"
              :open="expanded.has(item.id)"
              :class="{ ghost: pinned(i), flash: flashing.has(item.id) }"
              @open="toggle(item.id)"
              @remove="emit('remove', item.id)"
            >
              <template #meta><slot name="meta" :item="item" /></template>
            </StreamRow>
            <div v-if="expanded.has(item.id)" class="body">
              <slot name="body" :item="item" />
            </div>
          </section>
        </div>
      </div>
      <div
        v-for="where in ['top', 'bottom'] as const"
        v-show="bands[where].more.length || bands[where].shown.length"
        :key="where"
        class="pins"
        :class="[where, { 'has-more': bands[where].more.length }]"
      >
        <button
          v-if="bands[where].more.length"
          class="more"
          :class="{ flash: bands[where].more.some((i) => flashing.has(items[i].id)) }"
          @mousedown.prevent
          @click="popover = popover === where ? null : where"
        >
          <span>{{ bands[where].more.length }} more</span>
        </button>
        <StreamRow
          v-for="i in bands[where].shown"
          :key="items[i].id"
          class="pinned"
          :class="{ flash: flashing.has(items[i].id) }"
          :data-id="items[i].id"
          :title="items[i].title"
          :open="expanded.has(items[i].id)"
          @open="goTo(items[i].id)"
          @remove="emit('remove', items[i].id)"
        >
          <template #meta><slot name="meta" :item="items[i]" /></template>
        </StreamRow>
      </div>
      <div v-if="popover" class="popover" :class="popover">
        <button
          v-for="it in popoverItems"
          :key="it.id"
          :data-id="it.id"
          @mousedown.prevent
          @click="goTo(it.id)"
        >
          {{ it.title }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stream {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

.scroll {
  position: absolute;
  inset: 0;
  overflow-y: auto;
}

.cards {
  padding: 6px 6px 0;
}

.card {
  margin-bottom: 6px;
  overflow: hidden;
  background: var(--ground);
  border-radius: 6px;
  /* border 는 제목 줄을 1px 밀어, 카드 위치로 계산한 붙는 자리와 어긋난다. */
  outline: 1px solid var(--line);
  outline-offset: -1px;
}

.row.ghost {
  visibility: hidden;
}

.row.flash,
.more.flash {
  background: color-mix(in srgb, var(--hdr), var(--accent) 25%);
}

.body {
  padding: 10px 16px 14px;
}

.card > .row {
  border-bottom: none;
}

.card > .row.open {
  border-bottom: 1px solid var(--line);
}

.pins {
  position: absolute;
  left: 6px;
  right: 6px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 좌우 선을 border 로 두면 붙은 제목 줄이 카드 안에 있을 때보다 1px 안으로 들어가, 붙는 순간 글자가 흔들린다. */
.pins::after {
  content: '';
  position: absolute;
  inset: 0;
  border: solid var(--line);
  border-width: 0 1px;
  pointer-events: none;
}

.pins.top {
  top: 0;
  box-shadow: 0 2px 6px rgb(0 0 0 / 25%);
}

.pins.bottom {
  bottom: 0;
  box-shadow: 0 -2px 6px rgb(0 0 0 / 25%);
}

.pins.bottom .row,
.pins.bottom .more {
  border-top: 1px solid var(--line);
  border-bottom: none;
}

/* 넘친 제목 줄은 화면에서 먼 쪽 — 아래쪽 묶음에서는 맨 아래다. */
.pins.bottom .more {
  order: 1;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

.more {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: var(--row-h);
  background: var(--hdr);
  border-bottom: 1px solid var(--line);
  color: var(--faint);
  font-size: 12px;
}

/* 넘친 제목들이 바로 옆의 붙은 제목 줄 뒤에 포개져 있는 것처럼 보이도록, 줄 안에 바깥쪽으로 갈수록 좁아지는 카드 두 장을 그린다.
   붙은 제목 묶음의 좌우 선이 이 줄까지 이어지면 카드가 상자 안에 든 것처럼 보이므로, 좌우 선은 이 줄을 빼고 긋는다. */
.more {
  position: relative;
  isolation: isolate;
  padding-top: 7px;
  background: var(--ground);
}

.more,
.pins.bottom .more {
  border: none;
}

.pins.top.has-more::after {
  top: var(--row-h);
  border-width: 1px 1px 0;
  border-radius: 5px 5px 0 0;
}

.pins.bottom.has-more::after {
  bottom: var(--row-h);
  border-width: 0 1px 1px;
  border-radius: 0 0 5px 5px;
}

.pins.top.has-more .row:first-of-type {
  border-radius: 5px 5px 0 0;
}

.pins.bottom.has-more .row:last-of-type {
  border-radius: 0 0 5px 5px;
}

.more::before,
.more::after {
  content: '';
  position: absolute;
  bottom: -1px;
  z-index: -1;
  border: 1px solid var(--line);
  border-radius: 5px 5px 0 0;
}

.more::before {
  top: 2px;
  left: 8px;
  right: 8px;
  background: color-mix(in srgb, var(--hdr), var(--ground) 50%);
}

.more::after {
  top: 6px;
  left: 4px;
  right: 4px;
  background: var(--hdr);
}

.more > span {
  position: relative;
}

.pins.bottom .more {
  padding: 0 0 7px;
}

.pins.bottom .more::before,
.pins.bottom .more::after {
  top: -1px;
  border-radius: 0 0 5px 5px;
}

.pins.bottom .more::before {
  bottom: 2px;
}

.pins.bottom .more::after {
  bottom: 6px;
}

.more:hover {
  color: var(--fg);
}

.popover {
  position: absolute;
  left: 10px;
  right: 10px;
  z-index: 2;
  max-height: 60%;
  overflow-y: auto;
  padding: 4px 0;
  background: var(--raised);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
}

.popover.top {
  top: calc(var(--row-h) + 4px);
}

.popover.bottom {
  bottom: calc(var(--row-h) + 4px);
}

.popover button {
  display: block;
  width: 100%;
  padding: 4px 12px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--fg);
}

.popover button:hover {
  background: var(--hover);
}
</style>
