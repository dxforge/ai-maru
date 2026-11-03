import { describe, expect, it } from 'vitest'
import {
  autoWorkspaceName,
  cellLabel,
  dirName,
  labelBase,
  nameOnFocusLoss,
  sidebarLabel,
  windowTitle,
  workspaceDir,
  workspaceName
} from './names'

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

describe('autoWorkspaceName', () => {
  const ws = (pane: { cwd?: string; git?: { repo: string; branch?: string } }, name?: string) => ({
    ...(name !== undefined && { name }),
    cells: [{ panes: [pane, { cwd: '/tmp/other' }] }, { panes: [{ cwd: '/tmp/third' }] }]
  })

  it('첫 cell 의 첫 pane 이 저장소 안이면 branch 없이 저장소 이름, 밖이면 디렉토리 이름, 모르면 Shell 이다', () => {
    expect(
      autoWorkspaceName(ws({ cwd: '/r/ai-maru/app', git: { repo: 'ai-maru', branch: 'main' } }))
    ).toBe('ai-maru')
    expect(autoWorkspaceName(ws({ cwd: '/tmp/notes' }))).toBe('notes')
    expect(autoWorkspaceName(ws({}))).toBe('Shell')
  })

  it('home 을 주면 홈 디렉토리는 ~ 다', () => {
    expect(autoWorkspaceName(ws({ cwd: '/h/u' }), '/h/u')).toBe('~')
    expect(autoWorkspaceName(ws({ cwd: '/h/u' }))).toBe('u')
    expect(autoWorkspaceName(ws({ cwd: '/h/u/notes' }), '/h/u')).toBe('notes')
  })

  it('바꾼 이름이 있어도 첫 pane 으로 짓는다', () => {
    expect(autoWorkspaceName(ws({ cwd: '/tmp/notes' }, '리뷰'))).toBe('notes')
  })
})

describe('workspaceName', () => {
  const ws = (name?: string) => ({
    ...(name !== undefined && { name }),
    cells: [{ panes: [{ cwd: '/h/u', git: { repo: 'ai-maru', branch: 'main' } }] }]
  })

  it('바꾼 이름이 없으면 첫 cell 의 첫 pane 으로 짓는다', () => {
    expect(workspaceName(ws())).toBe('ai-maru')
    expect(workspaceName({ cells: [{ panes: [{ cwd: '/h/u' }] }] }, '/h/u')).toBe('~')
  })

  it('바꾼 이름이 있으면 pane 의 위치와 상관없이 그 이름이다', () => {
    expect(workspaceName(ws('리뷰'))).toBe('리뷰')
    expect(workspaceName(ws('ai-maru'))).toBe('ai-maru')
  })
})

describe('workspaceDir', () => {
  const ws = (...cells: { cwd?: string }[][]) => ({
    cells: cells.map((panes) => ({ panes }))
  })

  it('첫 cell 의 첫 pane 의 cwd 를 쓰고, 다른 pane 은 보지 않는다', () => {
    expect(workspaceDir(ws([{ cwd: '~/work/app' }, { cwd: '/c' }], [{ cwd: '/d' }]))).toBe(
      '~/work/app'
    )
  })

  it('그 pane 의 cwd 를 모르면 없다', () => {
    expect(workspaceDir(ws([{}, { cwd: '/b' }]))).toBeUndefined()
  })
})

describe('nameOnFocusLoss', () => {
  it('앞뒤 공백을 자른 값이 열 때의 이름과 같으면 취소다', () => {
    expect(nameOnFocusLoss('ai-maru', 'ai-maru')).toBeNull()
    expect(nameOnFocusLoss('  ai-maru ', 'ai-maru')).toBeNull()
  })

  it('다르면 친 값을 확정하고, 비웠으면 빈 값을 넘겨 자동 이름으로 돌아가게 한다', () => {
    expect(nameOnFocusLoss('review', 'ai-maru')).toBe('review')
    expect(nameOnFocusLoss('ai-maru2', 'ai-maru')).toBe('ai-maru2')
    expect(nameOnFocusLoss('  ', 'ai-maru')).toBe('  ')
  })
})

describe('labelBase', () => {
  const first = { cwd: '/r/ai-maru' }
  const second = { cwd: '/tmp/notes' }

  it('바꾼 이름이 없으면 첫 cell 의 첫 pane 이다', () => {
    expect(labelBase({ cells: [{ panes: [first, second] }] })).toBe(first)
  })

  it('바꾼 이름이 있으면 없다', () => {
    expect(labelBase({ name: '리뷰', cells: [{ panes: [first] }] })).toBeUndefined()
  })
})

describe('windowTitle', () => {
  it('이름 — branch 이고, branch 가 없으면 이름이다', () => {
    expect(windowTitle({ name: 'ai-maru', branch: 'main' })).toBe('ai-maru — main')
    expect(windowTitle({ name: 'notes' })).toBe('notes')
  })
})
