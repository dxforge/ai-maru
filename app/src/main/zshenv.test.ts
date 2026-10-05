import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ZSH = '/bin/zsh'
const zdotdir = join(__dirname, '../../resources/zsh')

function home(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'maru-zsh-'))
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

function loginShell(homeDir: string, command: string, cwd = homeDir): string {
  const r = spawnSync(ZSH, ['-l', '-i', '-c', command], {
    cwd,
    env: { HOME: homeDir, ZDOTDIR: zdotdir, PATH: '/usr/bin:/bin', HOST: 'mac' },
    encoding: 'utf8',
    timeout: 10_000
  })
  if (r.status !== 0) throw new Error(`zsh exited ${r.status}: ${r.stderr}`)
  return r.stdout
}

describe.skipIf(!existsSync(ZSH))('앱의 .zshenv', () => {
  it('공백·한글이 든 디렉토리를 바이트 단위로 퍼센트 인코딩해 OSC 7 로 보낸다', () => {
    const h = home({ '.zshrc': '' })
    const dir = join(h, 'a b', '한글')
    mkdirSync(dir, { recursive: true })
    const encoded = `${realpathSync(h)}/a%20b/%ED%95%9C%EA%B8%80`
    expect(loginShell(h, '_maru_osc7', dir)).toBe(`\x1b]7;file://mac${encoded}\x07`)
  })

  it('프롬프트마다 돌도록 precmd 에 단다', () => {
    const h = home({ '.zshrc': '' })
    expect(loginShell(h, 'print -l $precmd_functions')).toContain('_maru_osc7')
  })

  it('사용자의 ~/.zshrc 를 읽는다', () => {
    const h = home({ '.zshrc': 'MARK=rc' })
    expect(loginShell(h, 'print $MARK')).toBe('rc\n')
  })

  it('사용자의 ~/.zprofile·~/.zlogin 도 읽는다', () => {
    const h = home({ '.zprofile': 'P=profile', '.zlogin': 'L=login', '.zshrc': '' })
    expect(loginShell(h, 'print $P $L')).toBe('profile login\n')
  })

  it('~/.zshenv 가 정한 ZDOTDIR 에서 나머지 시작 파일을 읽는다', () => {
    const h = home({
      '.zshenv': 'export ZDOTDIR=$HOME/cfg',
      'cfg/.zshrc': 'MARK=cfg',
      '.zshrc': 'MARK=home'
    })
    expect(loginShell(h, 'print $MARK')).toBe('cfg\n')
  })
})
