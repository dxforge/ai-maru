import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns
} from 'node:child_process'
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

/**
 * 대화형 zsh 는 stdin 이 tty 가 아니어도 `/dev/tty` 가 열리면 거기서 읽으므로, 터미널 안에서 돌리면 stdin 의 명령을
 * 받지 않고 멈춘다. `detached` 로 controlling tty 가 없는 새 세션에서 띄워 stdin 을 읽게 한다. `SpawnSyncOptions`
 * 타입에는 `detached` 가 없지만, Node 의 `spawnSync` 도 이 옵션을 받아 새 세션에서 띄운다. `spawnSync` 가 timeout 에
 * 보내는 기본 SIGTERM 은 대화형 zsh 가 무시하므로 SIGKILL 로 종료한다.
 */
function spawnZsh(args: string[], homeDir: string, cwd: string, env: object, input?: string) {
  const options: SpawnSyncOptionsWithStringEncoding & { detached: true } = {
    cwd,
    env: { HOME: homeDir, ZDOTDIR: zdotdir, PATH: '/usr/bin:/bin', HOST: 'mac', ...env },
    input,
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL',
    detached: true
  }
  return spawnSync(ZSH, ['-l', '-i', ...args], options)
}

function spawnLogin(homeDir: string, command: string, cwd = homeDir, env = {}) {
  return spawnZsh(['-c', command], homeDir, cwd, env)
}

function stdoutOf(r: SpawnSyncReturns<string>): string {
  if (r.status !== 0) throw new Error(`zsh exited ${r.status}: ${r.stderr}`)
  return r.stdout
}

function loginShell(homeDir: string, command: string, cwd = homeDir): string {
  return stdoutOf(spawnLogin(homeDir, command, cwd))
}

/**
 * 명령을 stdin 으로 넣어 프롬프트를 거치게 한다. `-c` 로 받은 명령 앞에서는 precmd 가 돌지 않는다.
 * 돌려주는 stdout 에서 precmd 의 OSC 7 은 뺀다.
 */
function atPrompt(homeDir: string, commands: string[], env: object = {}): string {
  const r = spawnZsh([], homeDir, homeDir, env, `${commands.join('\n')}\n`)
  // eslint-disable-next-line no-control-regex
  return stdoutOf(r).replace(/\x1b\]7;[^\x07]*\x07/g, '')
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

describe.skipIf(!existsSync(ZSH))('앱의 .zshenv 의 PATH', () => {
  const bin = '/opt/maru'
  /** 앱이 PATH 맨 앞에 붙인 maru 디렉토리를 `.zprofile` 이 뒤로 밀어낸 상태. macOS 의 path_helper 가 하는 일이다. */
  const pushedBack = (files: Record<string, string> = {}) =>
    home({ '.zprofile': 'path=(/opt/first $path)', '.zshrc': '', ...files })

  it('시작 파일이 maru 디렉토리를 뒤로 밀어도 첫 프롬프트에는 맨 앞에 있다', () => {
    expect(atPrompt(pushedBack(), ['print $path[1]'], appEnv(bin))).toBe(`${bin}\n`)
  })

  it('마지막에 읽는 ~/.zlogin 이 다시 밀어도 첫 프롬프트에는 맨 앞에 있다', () => {
    const h = pushedBack({ '.zlogin': 'path=(/opt/last $path)' })
    expect(atPrompt(h, ['print $path[1]'], appEnv(bin))).toBe(`${bin}\n`)
  })

  it('첫 프롬프트 뒤에는 precmd 에서 빠진다', () => {
    expect(atPrompt(pushedBack(), ['print -l $precmd_functions'], appEnv(bin))).not.toContain(
      '_maru_path'
    )
  })

  it('빠지면서도 사용자가 뒤에 단 precmd hook 을 건너뛰지 않는다', () => {
    const h = pushedBack({ '.zshrc': '_mine() { print mine $path[1] }; precmd_functions+=(_mine)' })
    expect(atPrompt(h, ['true'], appEnv(bin))).toBe(`mine ${bin}\nmine ${bin}\n`)
  })

  it('패키징된 앱처럼 디렉토리에 공백이 있어도 통째로 옮긴다', () => {
    const spaced = '/opt/AI Maru/bin'
    expect(atPrompt(pushedBack(), ['print $path[1]'], appEnv(spaced))).toBe(`${spaced}\n`)
  })

  it('사용자가 globsubst·shwordsplit 을 켜도 같다', () => {
    const h = pushedBack({ '.zshrc': 'setopt globsubst shwordsplit' })
    expect(atPrompt(h, ['print $path[1]'], appEnv(bin))).toBe(`${bin}\n`)
  })

  it('사용자 ~/.zshrc 가 PATH 를 통째로 다시 써도 되살린다', () => {
    const h = pushedBack({ '.zshrc': 'export PATH=/opt/mine:/usr/bin:/bin' })
    expect(atPrompt(h, ['print $PATH'], appEnv(bin))).toBe(`${bin}:/opt/mine:/usr/bin:/bin\n`)
  })

  it('이미 PATH 에 있는 maru 디렉토리는 앞으로 옮기고 두 번 넣지 않는다', () => {
    const h = pushedBack({ '.zshrc': `export PATH=/opt/mine:${bin}:/usr/bin:/bin` })
    expect(atPrompt(h, ['print $PATH'], appEnv(bin))).toBe(`${bin}:/opt/mine:/usr/bin:/bin\n`)
  })

  it('사용자가 프롬프트에서 바꾼 PATH 는 다음 프롬프트에도 그대로다', () => {
    expect(atPrompt(pushedBack(), ['path=(/opt/mine $path)', 'print $path[1]'], appEnv(bin))).toBe(
      '/opt/mine\n'
    )
  })

  it('앱 밖(MARU_CLI 없음)에서는 PATH 를 건드리지 않는다', () => {
    expect(atPrompt(pushedBack(), ['print $path[1]'], { PATH: `${bin}:/usr/bin:/bin` })).toBe(
      '/opt/first\n'
    )
  })
})

function fakes(
  dir: string,
  claudeExit: string | ((log: string) => string)
): { bin: string; log: string } {
  const bin = join(dir, 'fakebin')
  const log = join(dir, 'calls.log')
  mkdirSync(bin, { recursive: true })
  const record = (name: string) => `#!/bin/sh\necho "${name} $*" >> '${log}'\n`
  const exit = typeof claudeExit === 'function' ? claudeExit(log) : claudeExit
  writeFileSync(join(bin, 'claude'), `${record('claude')}${exit}\n`, { mode: 0o755 })
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

function loginShellWith(homeDir: string, env: Record<string, string>, command: string): string {
  return stdoutOf(spawnLogin(homeDir, command, homeDir, env))
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

  const recordHyperlink = (log: string) =>
    `echo "hyperlink=\${FORCE_HYPERLINK-unset} marker=\${MARU_CLAUDE_FORCED_HYPERLINK-unset} zdotdir=\${ZDOTDIR-unset}" >> '${log}'; exit 0`

  it('claude 에만 FORCE_HYPERLINK=1 과 표식·앱 ZDOTDIR 을 붙이고 셸에는 남기지 않는다', () => {
    const h = home({ '.zshrc': '' })
    const { bin, log } = fakes(h, recordHyperlink)
    expect(
      shellWith(h, appEnv(bin), 'claude; print shell=${FORCE_HYPERLINK-unset} ${ZDOTDIR-unset}')
    ).toBe('shell=unset unset\n')
    expect(readFileSync(log, 'utf8')).toContain(`hyperlink=1 marker=1 zdotdir=${zdotdir}\n`)
  })

  it.each(['0', ''])(
    '사용자가 FORCE_HYPERLINK 를 %j 로 정해 두었으면 그 값을 두고 표식도 붙이지 않는다',
    (value) => {
      const h = home({ '.zshrc': '' })
      const { bin, log } = fakes(h, recordHyperlink)
      shellWith(h, { ...appEnv(bin), FORCE_HYPERLINK: value }, 'claude')
      expect(readFileSync(log, 'utf8')).toContain(`hyperlink=${value} marker=unset zdotdir=unset\n`)
    }
  )

  it('claude 안(CLAUDECODE)에서 띄운 claude 는 plugin·env 없이 그대로 부르고 앱에 알리지 않는다', () => {
    const h = home({ '.zshrc': '' })
    const { bin, log } = fakes(h, recordHyperlink)
    shellWith(h, { ...appEnv(bin), CLAUDECODE: '1' }, 'claude --version')
    expect(readFileSync(log, 'utf8')).toBe(
      'claude --version\nhyperlink=unset marker=unset zdotdir=unset\n'
    )
  })

  it('claude 의 Bash 도구가 띄우는 로그인 셸은 표식을 보고 FORCE_HYPERLINK 를 지운다', () => {
    const h = home({ '.zshrc': '' })
    const forced = { FORCE_HYPERLINK: '1', MARU_CLAUDE_FORCED_HYPERLINK: '1' }
    const print =
      'print ${FORCE_HYPERLINK-unset} ${MARU_CLAUDE_FORCED_HYPERLINK-unset} ${ZDOTDIR-unset}'
    expect(loginShellWith(h, forced, print)).toBe('unset unset unset\n')
    // 표식이 없으면 사용자가 정한 값이라 둔다.
    expect(loginShellWith(h, { FORCE_HYPERLINK: '1' }, print)).toBe('1 unset unset\n')
  })

  it('사용자 ~/.zshenv 의 claude alias 를 거쳐도 앱 plugin 이 실린다', () => {
    const h = home({ '.zshenv': "alias claude='claude --mine'", '.zshrc': '' })
    const { bin, log } = fakes(h, 'exit 0')
    const r = spawnLogin(h, 'claude', h, appEnv(bin))
    expect(r.stderr).toBe('')
    expect(readFileSync(log, 'utf8')).toBe('claude --plugin-dir /plug --mine\nmaru claude exit\n')
  })
})
