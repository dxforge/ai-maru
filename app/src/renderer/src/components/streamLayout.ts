// 붙는 제목 계산은 제목 줄 높이에 기대므로 CSS 도 이 값을 쓴다(`CardStream.vue` 가 `--row-h` 로 넘긴다).
export const ROW_H = 26

// 위·아래 각각 붙는 제목의 수. 넘친 제목은 바깥쪽 한 줄로 묶는다.
export const PIN_CAP = 2

export type Pins = { above: number; below: number }

export type Band = { more: number[]; shown: number[] }

export type CardBox = { id: string; top: number; height: number }

export type Layout = { scrollTop: number; cards: CardBox[] }

export function bandRows(k: number): number {
  return k <= PIN_CAP ? k : PIN_CAP + 1
}

// 제목이 붙어도 묶음이 자라지 않으면 제목이 묶음 밑으로 다 들어간 뒤에 붙인다. 먼저 붙이면 묶음은 그대로인데
// 원래 자리만 숨어 그 높이만큼 빈칸이 남는다.
function late(k: number): number {
  return bandRows(k + 1) === bandRows(k) ? ROW_H : 0
}

// `tops` 는 스크롤 내용 안에서 제목 줄의 위치(위에서부터 차례대로)다.
export function computePins(tops: readonly number[], scrollTop: number, viewport: number): Pins {
  let above = 0
  while (above < tops.length && tops[above] + late(above) < scrollTop + bandRows(above) * ROW_H)
    above++
  let below = 0
  while (below < tops.length - above) {
    const top = tops[tops.length - 1 - below]
    if (top + ROW_H - late(below) > scrollTop + viewport - bandRows(below) * ROW_H) below++
    else break
  }
  return { above, below }
}

// 항목이 줄어든 뒤 다시 재기 전까지는 `pins` 가 줄기 전 항목 수로 센 값이다.
export function fitPins(n: number, { above, below }: Pins): Pins {
  const a = Math.min(above, n)
  return { above: a, below: Math.min(below, n - a) }
}

export function pinBands(n: number, pins: Pins): { top: Band; bottom: Band } {
  const { above, below } = fitPins(n, pins)
  const range = (from: number, to: number): number[] =>
    Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i)
  const topMore = Math.max(0, above - PIN_CAP)
  const bottomShown = Math.min(below, PIN_CAP)
  return {
    top: { more: range(0, topMore), shown: range(topMore, above) },
    bottom: {
      shown: range(n - below, n - below + bottomShown),
      more: range(n - below + bottomShown, n)
    }
  }
}

// 간 문서의 제목이 그 위 제목들로 채운 위쪽 묶음 바로 아래에 오는 scrollTop.
export function goToScrollTop(index: number, top: number): number {
  return Math.max(0, top - bandRows(index) * ROW_H)
}

// 문서가 들고 나거나 펼침이 바뀐 뒤 읽던 내용이 화면에서 움직이지 않는 scrollTop. 맨 위에 있었으면 맨 위에 둔다.
// 기준은 `anchor`(누른 제목의 문서)이고, 없으면 바뀌기 전 화면 맨 위에 걸친 문서다. 기준 문서가 사라졌으면 그 뒤에
// 남은 첫 문서를 쓴다.
export function anchorScroll(before: Layout, after: readonly CardBox[], anchor?: string): number {
  const { scrollTop, cards } = before
  if (scrollTop <= 0 && anchor === undefined) return 0
  let from = anchor === undefined ? -1 : cards.findIndex((c) => c.id === anchor)
  if (from === -1) from = cards.findIndex((c) => c.top + c.height > scrollTop)
  if (from === -1) return scrollTop
  for (const c of cards.slice(from)) {
    const j = after.findIndex((a) => a.id === c.id)
    if (j === -1) continue
    const { top, height } = after[j]
    // 기준 문서가 줄어 화면 맨 위까지의 거리보다 낮아졌으면, 그 거리를 더해 다음 문서로 넘어가지 않도록 그 문서의
    // 제목으로 간다.
    if (scrollTop - c.top >= height) return goToScrollTop(j, top)
    return Math.max(0, top + (scrollTop - c.top))
  }
  return scrollTop
}
