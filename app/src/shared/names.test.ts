import { describe, expect, it } from 'vitest'
import { cellLabel, dirName, sidebarLabel, windowTitle, workspaceName } from './names'

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

describe('sidebarLabel', () => {
  const head = (branch: string, sub = '', common = '/r/ai-maru/.git', repo = 'ai-maru') => ({
    repo,
    branch,
    common,
    sub
  })
  const base = { cwd: '/r/ai-maru', git: head('main') }

  it('같은 저장소면 branch 만, 하위 폴더면 그 상대 경로를 붙인다', () => {
    expect(sidebarLabel(base, base)).toEqual({ branch: 'main' })
    const wt = { cwd: '/r/wt', git: head('feat/148-sidebar') }
    expect(sidebarLabel(wt, base)).toEqual({ branch: 'feat/148-sidebar' })
    const sub = { cwd: '/r/ai-maru/app/e2e', git: head('main', 'app/e2e') }
    expect(sidebarLabel(sub, base)).toEqual({ branch: 'main', sub: 'app/e2e' })
  })

  it('다른 저장소면 저장소 이름과 branch 다', () => {
    const other = { cwd: '/r/ghostty', git: head('main', '', '/r/ghostty/.git', 'ghostty') }
    expect(sidebarLabel(other, base)).toEqual({ name: 'ghostty', branch: 'main' })
  })

  it('이름이 같아도 common 이 다른 클론은 다른 저장소다', () => {
    const clone = { cwd: '/x/ai-maru', git: head('main', '', '/x/ai-maru/.git') }
    expect(sidebarLabel(clone, base)).toEqual({ name: 'ai-maru', branch: 'main' })
  })

  it('common 이 없는 저장한 git 은 저장소 이름으로 비교한다', () => {
    const saved = { cwd: '/r/ai-maru', git: { repo: 'ai-maru', branch: 'dev' } }
    expect(sidebarLabel(saved, base)).toEqual({ branch: 'dev' })
  })

  it('같은 저장소인데 branch 를 모르면 저장소 이름이다', () => {
    const rt = { cwd: '/r/ai-maru', git: { repo: 'ai-maru', common: '/r/ai-maru/.git', sub: '' } }
    expect(sidebarLabel(rt, base)).toEqual({ name: 'ai-maru' })
  })

  it('git 밖이면 디렉토리 이름이고, 홈이면 ~ 다', () => {
    expect(sidebarLabel({ cwd: '/tmp/notes' }, base, '/h/u')).toEqual({ name: 'notes' })
    expect(sidebarLabel({ cwd: '/h/u' }, base, '/h/u')).toEqual({ name: '~' })
    expect(sidebarLabel({}, base, '/h/u')).toEqual({ name: 'Shell' })
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

  it('home 을 주면 홈 디렉토리는 ~ 다', () => {
    expect(workspaceName({ cwd: '/h/u' }, '/h/u')).toBe('~')
    expect(workspaceName({ cwd: '/h/u' })).toBe('u')
    expect(workspaceName({ cwd: '/h/u/notes' }, '/h/u')).toBe('notes')
  })
})

describe('windowTitle', () => {
  it('이름 — branch 이고, branch 가 없으면 이름이다', () => {
    expect(windowTitle({ name: 'ai-maru', branch: 'main' })).toBe('ai-maru — main')
    expect(windowTitle({ name: 'notes' })).toBe('notes')
  })
})
