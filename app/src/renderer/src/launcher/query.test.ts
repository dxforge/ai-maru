import { describe, expect, it } from 'vitest'
import { expandPath, filterRecent, joinDir, matchDirs, pathQuery, pickCommand } from './query'
import { SHELL } from '../../../shared/launcher'

const HOME = '/Users/me'

describe('expandPath', () => {
  it('~ 와 ~/ 를 홈으로 풀고 끝의 / 를 뗀다', () => {
    expect(expandPath('~', HOME)).toBe(HOME)
    expect(expandPath('~/', HOME)).toBe(HOME)
    expect(expandPath('~/work/', HOME)).toBe(`${HOME}/work`)
    expect(expandPath('/tmp//', HOME)).toBe('/tmp')
    expect(expandPath('/', HOME)).toBe('/')
  })

  it('~user 와 홈을 모를 때의 ~ 는 풀지 않는다', () => {
    expect(expandPath('~other/x', HOME)).toBe('~other/x')
    expect(expandPath('~/x', undefined)).toBe('~/x')
  })
})

describe('pathQuery', () => {
  it('마지막 / 까지를 부모로, 그 뒤를 조각으로 읽는다', () => {
    expect(pathQuery('~/wor', HOME)).toEqual({ prefix: '~/', fragment: 'wor', parent: HOME })
    expect(pathQuery('/', HOME)).toEqual({ prefix: '/', fragment: '', parent: '/' })
    expect(pathQuery('~/a/b/', HOME)).toEqual({
      prefix: '~/a/b/',
      fragment: '',
      parent: `${HOME}/a/b`
    })
  })

  it('~·/ 로 시작하지 않거나 / 가 없으면 경로 모드가 아니다', () => {
    expect(pathQuery('ai-maru', HOME)).toBeNull()
    expect(pathQuery('a/b', HOME)).toBeNull()
    expect(pathQuery('~', HOME)).toBeNull()
  })
})

describe('filterRecent', () => {
  const recent = [`${HOME}/work/ai-maru`, '/opt/Tools', `${HOME}/notes`]
  const paths = (query: string) => filterRecent(recent, query, HOME).map((r) => r.path)

  it('빈 입력이면 전부를 순서대로, 홈 아래는 ~ 로 줄인 이름으로 준다', () => {
    expect(filterRecent(recent, '  ', HOME)).toEqual([
      { path: `${HOME}/work/ai-maru`, label: '~/work/ai-maru' },
      { path: '/opt/Tools', label: '/opt/Tools' },
      { path: `${HOME}/notes`, label: '~/notes' }
    ])
  })

  it('단어마다 ~ 로 줄인 경로에 들어 있는 것만 대소문자 없이 남긴다', () => {
    expect(paths('MARU')).toEqual([`${HOME}/work/ai-maru`])
    expect(paths('work ai')).toEqual([`${HOME}/work/ai-maru`])
    expect(paths('tools')).toEqual(['/opt/Tools'])
    // 홈 경로 자체(`Users`)는 보이는 경로에 없으므로 걸리지 않는다.
    expect(paths('users')).toEqual([])
    expect(paths('work notes')).toEqual([])
  })

  it('NFD 로 저장된 한글 경로도 NFC 로 친 단어로 거른다', () => {
    const nfd = `${HOME}/${'프로젝트'.normalize('NFD')}`
    expect(filterRecent([nfd], '프로젝트', HOME).map((r) => r.path)).toEqual([nfd])
  })
})

describe('matchDirs', () => {
  const names = ['.config', 'Work', 'work', 'workspace', 'notes']

  it('조각으로 시작하는 이름을 대소문자 없이 남기고, 같은 이름을 앞에 둔다', () => {
    expect(matchDirs(names, 'wor')).toEqual(['Work', 'work', 'workspace'])
    expect(matchDirs(['workspace', 'work'], 'work')).toEqual(['work', 'workspace'])
  })

  it('NFD 로 저장된 한글 이름도 입력기로 친 NFC 조각과 맞고, 이름은 저장된 그대로 준다', () => {
    const nfd = '프로젝트'.normalize('NFD')
    expect(matchDirs([nfd, '문서'], '프로')).toEqual([nfd])
    expect(matchDirs([nfd], '프로젝트')).toEqual([nfd])
  })

  it('숨은 디렉토리는 조각이 . 으로 시작할 때만 남긴다', () => {
    expect(matchDirs(names, '')).toEqual(['Work', 'work', 'workspace', 'notes'])
    expect(matchDirs(names, '.')).toEqual(['.config'])
  })
})

describe('joinDir', () => {
  it('루트 아래에 / 를 겹치지 않는다', () => {
    expect(joinDir('/', 'tmp')).toBe('/tmp')
    expect(joinDir(HOME, 'work')).toBe(`${HOME}/work`)
  })
})

describe('pickCommand', () => {
  const commands = ['claude', 'codex', 'aider']

  it('기억한 명령이 목록에 있으면 그것을, 없으면 첫 명령을 고른다', () => {
    expect(pickCommand(commands, 'codex')).toBe('codex')
    expect(pickCommand(commands, 'gone')).toBe('claude')
    expect(pickCommand(commands, null)).toBe('claude')
  })

  it('기억한 것이 셸이면 목록과 상관없이 셸을 고른다', () => {
    expect(pickCommand(commands, SHELL)).toBe(SHELL)
  })
})
