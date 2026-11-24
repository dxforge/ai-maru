// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { overflowOf } from './overlayScroll'

describe('overflowOf', () => {
  it('고른 축만 스크롤하고, both 는 두 축 모두 스크롤한다', () => {
    expect(overflowOf('x')).toEqual({ x: 'scroll', y: 'hidden' })
    expect(overflowOf('y')).toEqual({ x: 'hidden', y: 'scroll' })
    expect(overflowOf('both')).toEqual({ x: 'scroll', y: 'scroll' })
  })
})

describe('overlayscrollbars.css', () => {
  // 이 규칙이 있으면 viewport 속성을 바꿀 때마다 Chrome 이 viewport 아래 요소 전부의 스타일을 다시 계산한다.
  // `app/patches/overlayscrollbars-2.17.1.patch` 가 이 규칙을 뺀다. 라이브러리는 viewport 자신이 rtl·reverse 방향일 때만
  // noContent 를 켜고, 앱의 viewport 에는 그런 방향이 없다. 그런 viewport 를 들이면 이 patch 를 다시 본다.
  it('noContent viewport 아래의 모든 요소를 고르는 규칙이 없다', () => {
    // vitest 는 CSS import 를 빈 문자열로 바꾸므로, `overlayScroll.ts` 가 import 하는 파일을 직접 읽는다.
    const file = createRequire(import.meta.url).resolve('overlayscrollbars/overlayscrollbars.css')
    const css = readFileSync(file, 'utf8')
    expect(css).toContain('[data-overlayscrollbars-viewport~=noContent]')
    expect(css).not.toMatch(/\[data-overlayscrollbars-viewport~=noContent\][^,{]*>\s*[*:]/)
  })
})
