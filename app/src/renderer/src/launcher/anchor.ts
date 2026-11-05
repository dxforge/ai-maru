import { SIDEBAR_WIDTH } from '../../../shared/screen'

/** 런처를 붙일 박스의 창 기준 좌표다. */
export type Anchor = { left: number; top: number; bottom: number; width: number }

export type Placement = {
  side: 'below' | 'above'
  left: number
  width: number
  /** `side` 가 `below` 면 창 위에서, `above` 면 창 아래에서 잰 거리다. */
  offset: number
  maxHeight: number
}

const GAP = 2
const MARGIN = 8

/**
 * 사이드바가 `SIDEBAR_WIDTH.min` 보다 좁으면 사이드바가 그 폭일 때의 박스 폭을, 아니면 박스 폭을 그대로 돌려준다. 접은
 * 사이드바의 박스는 이름이 다 잘릴 만큼 좁아서, 런처를 박스 폭으로 띄우면 명령 이름이 보이지 않기 때문이다.
 */
export function anchorWidth(box: number, sidebar: number): number {
  return Math.max(box, box + SIDEBAR_WIDTH.min - sidebar)
}

/**
 * 박스 아래에 런처가 다 들어가면 아래에, 아니면 아래와 위 가운데 자리가 넓은 쪽에 띄운다. `natural` 은 런처가 줄지 않았을
 * 때의 높이다. 창 오른쪽 밖으로 나가면 왼쪽으로 당긴다.
 */
export function placeAnchored(
  a: Anchor,
  view: { width: number; height: number },
  natural: number
): Placement {
  const below = view.height - a.bottom - GAP - MARGIN
  const above = a.top - GAP - MARGIN
  const side = natural <= below || below >= above ? 'below' : 'above'
  const width = Math.min(a.width, view.width - 2 * MARGIN)
  return {
    side,
    left: Math.max(0, Math.min(a.left, view.width - MARGIN - width)),
    width,
    offset: side === 'below' ? a.bottom + GAP : view.height - a.top + GAP,
    maxHeight: Math.max(0, side === 'below' ? below : above)
  }
}
