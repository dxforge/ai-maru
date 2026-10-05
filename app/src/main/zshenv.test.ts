import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
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

function spawnLogin(homeDir: string, command: string, cwd = homeDir, env = {}) {
  return spawnSync(ZSH, ['-l', '-i', '-c', command], {
    cwd,
    env: { HOME: homeDir, ZDOTDIR: zdotdir, PATH: '/usr/bin:/bin', HOST: 'mac', ...env },
    encoding: 'utf8',
    timeout: 10_000
  })
}

function loginShell(homeDir: string, command: string, cwd = homeDir): string {
  const r = spawnLogin(homeDir, command, cwd)
  if (r.status !== 0) throw new Error(`zsh exited ${r.status}: ${r.stderr}`)
  return r.stdout
}

describe.skipIf(!existsSync(ZSH))('앱의 .zshenv', () => {
  it('공백·한글이 든 디렉토리를 바이트 단위로 퍼센트 인코딩해 OSC 7 로 보낸다', () => {
    const h = home({ '.zshrc': '' })
    const dir = join(h, 'a b', '한글')
    mkdirSync(dir, { recursive: true })
    const encoded = `${realpathSync(h)}/a%20b/%ED%95%9C%EA%B8%80`
    expect(loginShell(h, '_maru_osc7', dir)).toBe(`\x1b]7;file://${encoded}\x07`)
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

function fakes(dir: string, claudeExit: string): { bin: string; log: string } {
  const bin = join(dir, 'fakebin')
  const log = join(dir, 'calls.log')
  mkdirSync(bin, { recursive: true })
  const record = (name: string) => `#!/bin/sh\necho "${name} $*" >> '${log}'\n`
  writeFileSync(join(bin, 'claude'), `${record('claude')}${claudeExit}\n`, { mode: 0o755 })
  writeFileSync(join(bin, 'maru'), record('maru'), { mode: 0o755 })
  return { bin, log }
}

function appEnv(bin: string): Record<string, string> {
  return { PATH: `${bin}:/usr/bin:/bin`, MARU_CLI: join(bin, 'maru'), MARU_CLAUDE_PLUGIN: '/plug' }
}

/** 셸이 SIGINT 로 끝나는 경우도 보므로 종료 코드를 따지지 않는다. */
function shellWith(homeDir: string, env: Record<string, string>, command: string): string {
  return spawnLogin(homeDir, command, homeDir, env).stdout
}

describe.skipIf(!existsSync(ZSH))('앱의 .zshenv 의 claude 함수', () => {
  it('앱 plugin 을 실어 claude 를 띄우고, 끝나면 앱에 알린다', () => {
    const h = home({ '.zshrc': '' })
    const { bin, log } = fakes(h, 'exit 0')
    expect(shellWith(h, appEnv(bin), 'claude -p "a b"; print code=$?')).toBe('code=0\n')
    expect(readFileSync(log, 'utf8')).toBe('claude --plugin-dir /plug -p a b\nmaru claude exit\n')
  })

  it('claude 의 종료 코드를 돌려준다', () => {
    const h = home({ '.zshrc': '' })
    const { bin } = fakes(h, 'exit 3')
    expect(shellWith(h, appEnv(bin), 'claude; print code=$?')).toBe('code=3\n')
  })

  it('Ctrl-C 로 claude 와 함께 셸이 SIGINT 를 받아도 앱에 알린다', () => {
    const h = home({ '.zshrc': '' })
    const { bin, log } = fakes(h, 'kill -INT $PPID; kill -INT $$')
    shellWith(h, appEnv(bin), 'claude')
    expect(readFileSync(log, 'utf8')).toContain('maru claude exit\n')
  })

  it('앱의 값이 없으면 claude 를 그대로 부른다', () => {
    const h = home({ '.zshrc': '' })
    const { bin, log } = fakes(h, 'exit 0')
    shellWith(h, { PATH: `${bin}:/usr/bin:/bin` }, 'claude x')
    expect(readFileSync(log, 'utf8')).toBe('claude x\n')
  })

  it('사용자 alias 를 거쳐도 앱 plugin 이 실린다', () => {
    const h = home({ '.zshrc': "alias claude='claude --mine'" })
    const { bin, log } = fakes(h, 'exit 0')
    shellWith(h, appEnv(bin), 'claude')
    expect(readFileSync(log, 'utf8')).toBe('claude --plugin-dir /plug --mine\nmaru claude exit\n')
  })

  it('사용자 .zshrc 가 정의한 claude 함수가 이긴다', () => {
    const h = home({ '.zshrc': 'claude() { print mine }' })
    const { bin } = fakes(h, 'exit 0')
    expect(shellWith(h, appEnv(bin), 'claude')).toBe('mine\n')
  })

  it('사용자 ~/.zshenv 가 정의한 claude 함수도 이긴다', () => {
    const h = home({ '.zshenv': 'claude() { print mine }', '.zshrc': '' })
    const { bin } = fakes(h, 'exit 0')
    expect(shellWith(h, appEnv(bin), 'claude')).toBe('mine\n')
  })

  it('사용자 ~/.zshenv 의 claude alias 를 거쳐도 앱 plugin 이 실린다', () => {
    const h = home({ '.zshenv': "alias claude='claude --mine'", '.zshrc': '' })
    const { bin, log } = fakes(h, 'exit 0')
    const r = spawnLogin(h, 'claude', h, appEnv(bin))
    expect(r.stderr).toBe('')
    expect(readFileSync(log, 'utf8')).toBe('claude --plugin-dir /plug --mine\nmaru claude exit\n')
  })
})
