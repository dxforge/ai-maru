/** 버튼으로 오가는 배율이다. Chromium 의 페이지 확대 단계와 같다. 끝 값이 확대·축소의 한계다. */
export const ZOOM_STEPS = [
  0.25,
  1 / 3,
  0.5,
  2 / 3,
  0.75,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
  2.5,
  3,
  4,
  5
] as const

const MIN = ZOOM_STEPS[0]
const MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]!
// 단계 사이에 있는 배율에서 `stepZoom` 이 그 단계로 가지 않게, 부동소수 오차 안의 차이는 같은 배율로 본다.
const EPSILON = 1e-6

/** `scale` 에서 한 단계 크거나(`1`) 작은(`-1`) 배율. 단계 사이의 배율이면 그 방향의 가장 가까운 단계로 간다. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((s) => s > scale + EPSILON) ?? MAX
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - EPSILON) ?? MIN
}

/**
 * ⌘+휠·트랙패드 핀치의 wheel 한 번 뒤의 배율. Chromium 은 핀치를 `ctrlKey` 가 켜진 wheel 로 보내며 배율 `s` 를
 * `deltaY = -100·ln(s)` 로 적으므로, 그 역인 `exp(-deltaY / 100)` 를 곱하면 핀치한 만큼 커진다.
 */
export function wheelZoom(scale: number, deltaY: number): number {
  return Math.min(MAX, Math.max(MIN, scale * Math.exp(-deltaY / 100)))
}

/** 버튼에 보일 배율. */
export function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`
}
