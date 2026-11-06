import { describe, expect, it } from 'vitest'
import { AGENT_LOGOS, svgBody } from './agentLogos'

describe('svgBody', () => {
  it('루트의 viewBox 와 루트 안의 그림을 꺼내고 title 은 뺀다', () => {
    const svg =
      '<svg fill="currentColor" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Logo</title><path d="M0 0h24v24H0z"></path></svg>'
    expect(svgBody(svg)).toEqual({ viewBox: '0 0 24 24', body: '<path d="M0 0h24v24H0z"></path>' })
  })

  it('svg 가 아니면 던진다', () => {
    expect(() => svgBody('<path d="M0 0"/>')).toThrow()
  })
})

describe('AGENT_LOGOS', () => {
  it('세 로고 모두 그림이 있고 title 이 없다', () => {
    for (const logo of Object.values(AGENT_LOGOS)) {
      expect(logo.viewBox).toBe('0 0 24 24')
      expect(logo.body).toContain('<path')
      expect(logo.body).not.toContain('<title')
    }
  })
})
