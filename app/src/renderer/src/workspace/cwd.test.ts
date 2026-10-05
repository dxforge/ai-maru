import { describe, expect, it } from 'vitest'
import { osc7Path, workspaceName } from './cwd'

describe('osc7Path', () => {
  it('호스트가 빈 file URL 에서 경로를 꺼낸다', () => {
    expect(osc7Path('file:///tmp/a/src')).toBe('/tmp/a/src')
  })

  it('퍼센트 인코딩한 공백·한글을 푼다', () => {
    expect(osc7Path('file:///tmp/a%20b/%ED%95%9C%EA%B8%80')).toBe('/tmp/a b/한글')
  })

  it('호스트가 있으면 ssh 로 붙은 다른 머신의 경로일 수 있어 버린다', () => {
    expect(osc7Path('file://remote.example/tmp')).toBeNull()
    expect(osc7Path('file://foo.1/tmp')).toBeNull()
    expect(osc7Path('file://localhost/tmp')).toBeNull()
  })

  it('file 이 아니거나 깨진 값은 버린다', () => {
    expect(osc7Path('http://h/tmp')).toBeNull()
    expect(osc7Path('file:///tmp/%E0%A4%A')).toBeNull()
    expect(osc7Path('not a url')).toBeNull()
  })
})

describe('workspaceName', () => {
  it('경로의 마지막 이름이다', () => {
    expect(workspaceName('/tmp/a/src')).toBe('src')
    expect(workspaceName('/tmp/a/src/')).toBe('src')
  })

  it('루트는 / 다', () => {
    expect(workspaceName('/')).toBe('/')
  })

  it('모르면 Shell 이다', () => {
    expect(workspaceName(undefined)).toBe('Shell')
  })
})
