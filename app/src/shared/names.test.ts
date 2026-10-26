import { describe, expect, it } from 'vitest'
import { cellLabel, dirName, windowTitle, workspaceName } from './names'

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
