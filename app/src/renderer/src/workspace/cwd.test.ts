import { describe, expect, it } from 'vitest'
import { cellLabel, dirName, osc7Path, tildePath, windowTitle, workspaceName } from './cwd'

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

describe('dirName', () => {
  it('경로의 마지막 이름이다', () => {
    expect(dirName('/tmp/a/src')).toBe('src')
    expect(dirName('/tmp/a/src/')).toBe('src')
  })

  it('루트는 / 다', () => {
    expect(dirName('/')).toBe('/')
  })

  it('모르면 Shell 이다', () => {
    expect(dirName(undefined)).toBe('Shell')
  })
})

describe('cellLabel', () => {
  it('저장소 안이면 디렉토리 이름 대신 저장소 이름과 branch 다', () => {
    const git = { repo: 'ai-maru', branch: 'feat/1-x' }
    expect(cellLabel({ cwd: '/r/ai-maru/app', git })).toEqual({
      name: 'ai-maru',
      branch: 'feat/1-x'
    })
  })

  it('저장소 밖이거나 아직 모르면 디렉토리 이름만이다', () => {
    expect(cellLabel({ cwd: '/tmp/notes' })).toEqual({ name: 'notes' })
  })
})

describe('workspaceName', () => {
  it('저장소 안이면 branch 없이 저장소 이름, 밖이면 디렉토리 이름, 모르면 Shell 이다', () => {
    expect(workspaceName({ cwd: '/r/ai-maru/app', git: { repo: 'ai-maru', branch: 'main' } })).toBe(
      'ai-maru'
    )
    expect(workspaceName({ cwd: '/tmp/notes' })).toBe('notes')
    expect(workspaceName({})).toBe('Shell')
  })
})

describe('windowTitle', () => {
  it('이름 — branch 이고, branch 가 없으면 이름이다', () => {
    expect(windowTitle({ name: 'ai-maru', branch: 'main' })).toBe('ai-maru — main')
    expect(windowTitle({ name: 'notes' })).toBe('notes')
  })
})

describe('tildePath', () => {
  it('홈과 그 아래는 ~ 로 줄인다', () => {
    expect(tildePath('/u/a', '/u/a')).toBe('~')
    expect(tildePath('/u/a/w/x', '/u/a')).toBe('~/w/x')
  })

  it('이름만 홈으로 시작하는 형제 디렉토리나 홈 밖은 그대로다', () => {
    expect(tildePath('/u/ab/x', '/u/a')).toBe('/u/ab/x')
    expect(tildePath('/tmp', '/u/a')).toBe('/tmp')
  })

  it('홈이 / 로 끝나도 줄인다', () => {
    expect(tildePath('/u/a/x', '/u/a/')).toBe('~/x')
  })

  it('홈을 모르거나 / 이면 그대로다', () => {
    expect(tildePath('/tmp', undefined)).toBe('/tmp')
    expect(tildePath('/tmp', '/')).toBe('/tmp')
  })
})
