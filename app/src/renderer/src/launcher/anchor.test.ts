import { describe, expect, it } from 'vitest'
import { anchorWidth, placeAnchored } from './anchor'

const view = { width: 1000, height: 800 }

describe('placeAnchored', () => {
  it('아래에 다 들어가면 박스 바로 아래에 박스 폭으로 띄운다', () => {
    const p = placeAnchored({ left: 6, top: 100, bottom: 132, width: 268 }, view, 150)
    expect(p).toEqual({ side: 'below', left: 6, width: 268, offset: 134, maxHeight: 658 })
  })

  it('아래에 모자라고 위가 더 넓으면 박스 위로 뒤집고, 창 아래에서 잰 거리로 박스 위끝에 붙인다', () => {
    const p = placeAnchored({ left: 6, top: 700, bottom: 732, width: 268 }, view, 150)
    expect(p).toMatchObject({ side: 'above', offset: 102, maxHeight: 690 })
  })

  it('아래에 모자라도 아래가 위보다 넓으면 아래에 띄우고 높이를 남은 자리로 줄인다', () => {
    const p = placeAnchored({ left: 6, top: 300, bottom: 332, width: 268 }, view, 600)
    expect(p).toMatchObject({ side: 'below', offset: 334, maxHeight: 458 })
  })

  it('아래 자리가 런처 높이와 꼭 같으면 아래에 띄운다', () => {
    const p = placeAnchored({ left: 6, top: 600, bottom: 640, width: 268 }, view, 150)
    expect(p).toMatchObject({ side: 'below', maxHeight: 150 })
  })

  it('창 오른쪽 밖으로 나가는 폭이면 왼쪽으로 당기고, 창보다 넓으면 창 폭에 맞춘다', () => {
    expect(placeAnchored({ left: 900, top: 0, bottom: 30, width: 188 }, view, 100)).toMatchObject({
      left: 804,
      width: 188
    })
    expect(
      placeAnchored({ left: 6, top: 0, bottom: 30, width: 400 }, { width: 300, height: 800 }, 100)
    ).toMatchObject({ left: 6, width: 284 })
  })
})

describe('anchorWidth', () => {
  it('사이드바가 최소 폭 이상이면 박스 폭이고, 접은 사이드바에서는 최소 폭일 때의 박스 폭이다', () => {
    expect(anchorWidth(268, 280)).toBe(268)
    expect(anchorWidth(188, 200)).toBe(188)
    expect(anchorWidth(73, 85)).toBe(188)
  })
})
