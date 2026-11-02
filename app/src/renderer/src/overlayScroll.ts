import { ClickScrollPlugin, OverlayScrollbars } from 'overlayscrollbars'
import 'overlayscrollbars/overlayscrollbars.css'
import type { Directive } from 'vue'

OverlayScrollbars.plugin(ClickScrollPlugin)

/** 스크롤할 축. null 이면 스크롤바를 씌우지 않는다. */
export type ScrollAxis = 'x' | 'y' | null

/**
 * `el` 에 내용 위에 겹쳐 그리는 스크롤바를 씌운다. 시스템 스크롤바가 이미 overlay 면 씌우지 않고 시스템 것을 쓴다.
 * 요소 자신을 viewport 로 써서, scrollTop·scrollIntoView 를 쓰는 코드가 그대로 이 요소를 스크롤하게 한다.
 *
 * 라이브러리는 내용이 넘치는지 다시 재려고 `el` 의 하위 DOM 변경을 모두 지켜본다. `children` 이면 `el` 과 그 직계 자식의
 * 변경만 본다. 출력마다 하위 DOM 이 바뀌는 터미널을 담은 영역에 쓴다.
 */
export function attachOverlayScroll(el: HTMLElement, axis: ScrollAxis, children = false): void {
  if (!axis) return
  OverlayScrollbars(
    { target: el, elements: { viewport: el }, cancel: { nativeScrollbarsOverlaid: true } },
    {
      overflow: { x: axis === 'x' ? 'scroll' : 'hidden', y: axis === 'y' ? 'scroll' : 'hidden' },
      scrollbars: {
        theme: 'os-theme-maru',
        autoHide: 'scroll',
        autoHideDelay: 800,
        clickScroll: true
      },
      update: children
        ? {
            ignoreMutation: (m) => m.target !== el && m.target.parentNode !== el,
            elementEvents: null
          }
        : {}
    }
  )
}

export function detachOverlayScroll(el: HTMLElement): void {
  OverlayScrollbars(el)?.destroy()
}

export const vOverlayScroll: Directive<HTMLElement, ScrollAxis, 'children'> = {
  mounted(el, { value, modifiers }) {
    attachOverlayScroll(el, value, modifiers.children)
  },
  updated(el, { value, oldValue, modifiers }) {
    if (value === oldValue) return
    detachOverlayScroll(el)
    attachOverlayScroll(el, value, modifiers.children)
  },
  beforeUnmount(el) {
    detachOverlayScroll(el)
  }
}
