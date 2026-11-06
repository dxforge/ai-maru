import { describe, expect, it } from 'vitest'
import { CLAUDE_APP } from '../../shared/program-status'
import { SHELL } from '../../shared/launcher'
import { AGENT_ICONS, commandIcon, launcherIcon } from './icons'

describe('AGENT_ICONS', () => {
  it('OSC 7501 의 app 이름으로 로고를 찾는다', () => {
    expect(AGENT_ICONS.get(CLAUDE_APP)).toBe('claude')
    expect(AGENT_ICONS.get('codex')).toBe('codex')
    expect(AGENT_ICONS.get('kiro-cli')).toBe('kiro')
  })

  it('표에 없는 app 이름은 prototype 의 키여도 로고가 없다', () => {
    expect(AGENT_ICONS.get('claude')).toBeUndefined()
    expect(AGENT_ICONS.get('constructor')).toBeUndefined()
  })
})

describe('launcherIcon', () => {
  it('셸은 셸 아이콘이다', () => {
    expect(launcherIcon(SHELL)).toBe('terminal')
  })

  it('명령의 argv0 basename 이 표에 있으면 그 로고다', () => {
    expect(launcherIcon('claude --resume')).toBe('claude')
    expect(launcherIcon('/opt/bin/codex')).toBe('codex')
    expect(launcherIcon('kiro-cli chat')).toBe('kiro')
  })

  it('표에 없는 명령과 argv0 가 없는 명령은 도는 명령 아이콘이다', () => {
    expect(launcherIcon('vim')).toBe('running')
    expect(launcherIcon('claude-code')).toBe('running')
    expect(launcherIcon('   ')).toBe('running')
  })
})

describe('commandIcon', () => {
  it('명령이 없으면 셸, 도는 명령은 도는 중, 끝난 명령은 실패 아이콘이다', () => {
    expect(commandIcon(undefined)).toBe('terminal')
    expect(commandIcon({ running: true })).toBe('running')
    expect(commandIcon({ running: false })).toBe('failed')
  })
})
