import { describe, expect, it } from 'vitest'
import {
  expandPath,
  filterFavorites,
  filterRecent,
  firstDirRow,
  joinDir,
  listEntries,
  matchDirs,
  pathQuery,
  pickCommand,
  commandChoices,
  commandList
} from './query'
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

  it('즐겨찾기에 든 디렉토리는 표기가 달라도 빼고 준다', () => {
    const nfd = `${HOME}/${'프로젝트'.normalize('NFD')}`
    const favorites = [
      { dir: '/opt/Tools', name: 'tools' },
      { dir: `${HOME}/프로젝트`.normalize('NFC'), name: 'p' }
    ]
    expect(filterRecent([...recent, nfd], '', HOME, favorites).map((r) => r.path)).toEqual([
      `${HOME}/work/ai-maru`,
      `${HOME}/notes`
    ])
  })
})

describe('filterFavorites', () => {
  const favorites = [
    { dir: `${HOME}/src/atlas/server`, name: 'atlas' },
    { dir: '/opt/Tools', name: 'Toolbox' }
  ]
  const names = (query: string) => filterFavorites(favorites, query, HOME).map((r) => r.name)

  it('빈 입력이면 전부를 넣은 순서대로, 이름과 ~ 로 줄인 경로로 준다', () => {
    expect(filterFavorites(favorites, '', HOME)).toEqual([
      { path: `${HOME}/src/atlas/server`, label: '~/src/atlas/server', name: 'atlas' },
      { path: '/opt/Tools', label: '/opt/Tools', name: 'Toolbox' }
    ])
  })

  it('단어마다 이름이나 경로에 든 것만 남긴다', () => {
    expect(names('ATLAS')).toEqual(['atlas'])
    expect(names('server')).toEqual(['atlas'])
    expect(names('toolbox opt')).toEqual(['Toolbox'])
    expect(names('atlas opt')).toEqual([])
  })
})

describe('listEntries', () => {
  const fav = [{ path: '/f', label: '/f', name: 'f' }]
  const recent = [
    { path: '/a', label: '/a' },
    { path: '/b', label: '/b' }
  ]

  it('즐겨찾기가 없으면 묶음 제목 없이 최근 목록만 둔다', () => {
    expect(listEntries([], recent, false)).toEqual([
      { row: recent[0], index: 0 },
      { row: recent[1], index: 1 }
    ])
  })

  it('위 팔레트는 묶음 제목을 묶음 앞에 두고, index 는 즐겨찾기부터 이어 센다', () => {
    expect(listEntries(fav, recent, false)).toEqual([
      { title: 'Favorites' },
      { row: fav[0], index: 0 },
      { title: 'Recent' },
      { row: recent[0], index: 1 },
      { row: recent[1], index: 2 }
    ])
  })

  it('아래 팔레트는 목록이 뒤집혀 그려지므로 묶음 제목을 묶음 뒤에 둔다', () => {
    expect(listEntries(fav, recent, true)).toEqual([
      { row: fav[0], index: 0 },
      { title: 'Favorites' },
      { row: recent[0], index: 1 },
      { row: recent[1], index: 2 },
      { title: 'Recent' }
    ])
  })

  it('최근 목록이 비면 Recent 제목을 두지 않는다', () => {
    expect(listEntries(fav, [], false)).toEqual([{ title: 'Favorites' }, { row: fav[0], index: 0 }])
  })
})

describe('firstDirRow', () => {
  it('입력이 비면 즐겨찾기를 건너뛰고 최근 목록의 첫 행을 고른다', () => {
    expect(firstDirRow(2, 3, '')).toBe(2)
    expect(firstDirRow(2, 3, '  ')).toBe(2)
    expect(firstDirRow(0, 3, '')).toBe(0)
  })

  it('최근 목록이 비면 첫 즐겨찾기를 고른다', () => {
    expect(firstDirRow(2, 0, '')).toBe(0)
  })

  it('입력이 있으면 맞는 행 가운데 맨 앞을 고른다', () => {
    expect(firstDirRow(2, 3, 'atlas')).toBe(0)
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

  it('기억한 것이 셸이면 셸을 붙인 목록에서는 셸을, 뺀 목록에서는 첫 명령을 고른다', () => {
    expect(pickCommand(commandList(commands, true), SHELL)).toBe(SHELL)
    expect(pickCommand(commandList(commands, false), SHELL)).toBe('claude')
  })
})

describe('commandList', () => {
  it('셸은 shell 일 때만 끝에 붙는다', () => {
    expect(commandList(['claude', 'codex'], true)).toEqual(['claude', 'codex', SHELL])
    expect(commandList(['claude', 'codex'], false)).toEqual(['claude', 'codex'])
  })
})

describe('commandChoices', () => {
  it('셸 행은 shell 로 보이고, 입력한 낱말로 거른다', () => {
    const list = commandList(['claude', 'codex'], true)
    expect(commandChoices(list, '').map((r) => r.label)).toEqual(['claude', 'codex', 'shell'])
    expect(commandChoices(list, 'sh')).toEqual([{ command: SHELL, label: 'shell' }])
  })
})
