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
function zshEnv(homeDir: string, env: object): Record<string, string> {
  return { HOME: homeDir, ZDOTDIR: zdotdir, PATH: '/usr/bin:/bin', HOST: 'mac', ...env }
}

function spawnZsh(args: string[], homeDir: string, cwd: string, env: object, input?: string) {
  const options: SpawnSyncOptionsWithStringEncoding & { detached: true } = {
    cwd,
    env: zshEnv(homeDir, env),
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

const CLEAR = '\x1b]7501;state=clear\x1b\\'

const EXPECT = '/usr/bin/expect'

/**
 * `expect` 의 `spawn` 이 만든 pty 를 controlling tty 로 쥔 zsh 에서 돌린다. `spawnZsh` 의 셸에는 tty 가
 * 없어 `/dev/tty` 에 쓰는 것을 볼 수 없고, `script` 는 자기 stdin 이 tty 여야 돈다. 돌려주는 값은 pty 에
 * 찍힌 출력 전부다. 명령은 Tcl 의 따옴표 규칙을 피해 env 로 넘긴다.
 */
function ttyShellWith(homeDir: string, env: Record<string, string>, command: string): string {
  const script = `spawn -noecho ${ZSH} -l -i -c $env(MARU_TEST_COMMAND); expect eof`
  const r = spawnSync(EXPECT, ['-c', script], {
    cwd: homeDir,
    env: { ...zshEnv(homeDir, env), MARU_TEST_COMMAND: command },
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL'
  })
  return r.stdout
}

const PROMPT = 'P> '

function ttyPrompt(
  files: Record<string, string>,
  commands: string[],
  env: Record<string, string> = {}
): string {
  const h = home({ ...files, '.zshrc': `${files['.zshrc'] ?? ''}\nPS1='${PROMPT}'` })
  const script = [
    `spawn -noecho ${ZSH} -l -i`,
    `expect "${PROMPT}"`,
    `foreach c [split $env(MARU_TEST_COMMANDS) "\\n"] { send -- "$c\\r"; expect "${PROMPT}" }`,
    'send "exit\\r"',
    'expect eof'
  ].join('\n')
  const r = spawnSync(EXPECT, ['-c', script], {
    cwd: h,
    env: { ...zshEnv(h, env), MARU_TEST_COMMANDS: commands.join('\n') },
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL'
  })
  return r.stdout
}

const marks = (out: string): string[] =>
  // eslint-disable-next-line no-control-regex
  [...out.matchAll(/\x1b\]133;([^\x07]*)\x07/g)].map((m) => m[1])

describe.skipIf(!existsSync(ZSH) || !existsSync(EXPECT))('앱의 .zshenv 의 OSC 133', () => {
  it('프롬프트마다 A, 명령이 시작하면 명령 텍스트를 실은 C, 끝나면 종료 코드를 실은 D 를 tty 에 쓴다', () => {
    expect(marks(ttyPrompt({}, ['print hi', 'false']))).toEqual([
      'A',
      'C;cmdline_url=print%20hi',
      'D;0',
      'A',
      'C;cmdline_url=false',
      'D;1',
      'A',
      'C;cmdline_url=exit'
    ])
  })

  it('명령 텍스트의 ; 와 % 와 한글을 바이트 단위로 퍼센트 인코딩한다', () => {
    expect(marks(ttyPrompt({}, ["print 'a;b%c 한'"]))[1]).toBe(
      'C;cmdline_url=print%20%27a%3Bb%25c%20%ED%95%9C%27'
    )
  })

  it('명령 텍스트는 앞 169 글자만 싣고, 명령은 자르지 않고 실행한다', () => {
    const long = '한'.repeat(200)
    const out = ttyPrompt({}, [`print -r -- ${long}`])
    expect(marks(out)[1]).toBe(
      `C;cmdline_url=print%20-r%20--%20${'%ED%95%9C'.repeat(169 - 'print -r -- '.length)}`
    )
    expect(out).toContain(`${long}\r\n`)
  })

  // Ctrl-Z 대신 스스로 SIGSTOP 을 보낸다. 테스트를 띄운 환경이 SIGTSTP 를 무시하게 해 두었으면 셸이 그것을 물려받아
  // Ctrl-Z 로 멈추지 않기 때문이다.
  const stops = (n: number): string => `sh -c '${Array(n).fill('kill -STOP $$').join('; ')}'`
  const startOf = (command: string): string => {
    const url = [...Buffer.from(command)]
      .map((b) =>
        /[A-Za-z0-9/._~-]/.test(String.fromCharCode(b))
          ? String.fromCharCode(b)
          : `%${b.toString(16).toUpperCase().padStart(2, '0')}`
      )
      .join('')
    return `C;cmdline_url=${url}`
  }

  it('멈춘 명령은 종료 코드 없는 D 를 보내고, fg 로 다시 이으면 그 job 의 명령을 C 에 싣는다', () => {
    expect(marks(ttyPrompt({}, [stops(1), 'false', 'fg']))).toEqual([
      'A',
      startOf(stops(1)),
      'D',
      'A',
      'C;cmdline_url=false',
      'D;1',
      'A',
      startOf(stops(1)),
      'D;0',
      'A',
      'C;cmdline_url=exit'
    ])
  })

  it('fg %번호·%접두어·%?부분과 %만 친 job 지정도 그 job 의 명령으로 싣는다', () => {
    const out = ttyPrompt({}, [stops(4), 'fg %1', '%sh', '%?STOP', '%'])
    expect(marks(out).filter((m) => m.startsWith('C'))).toEqual([
      ...Array(5).fill(startOf(stops(4))),
      'C;cmdline_url=exit'
    ])
    expect(marks(out).filter((m) => m.startsWith('D'))).toEqual(['D', 'D', 'D', 'D', 'D;0'])
  })

  it('exec 로 시작하는 명령에는 C 를 보내지 않는다', () => {
    expect(marks(ttyPrompt({}, ['exec zsh']))).toEqual(['A'])
  })

  it('claude 안(CLAUDECODE)의 셸은 OSC 133 을 쓰지 않는다', () => {
    expect(marks(ttyPrompt({}, ['true'], { CLAUDECODE: '1' }))).toEqual([])
  })

  it('사용자 ~/.zshrc 가 preexec 배열을 덮고 precmd hook 을 더해도 그대로 알리고, 사용자 hook 도 돈다', () => {
    const out = ttyPrompt(
      { '.zshrc': '_mine() { print -n MINE }; preexec_functions=(); precmd_functions+=(_mine)' },
      ['false']
    )
    expect(marks(out)).toEqual(['A', 'C;cmdline_url=false', 'D;1', 'A', 'C;cmdline_url=exit'])
    expect(out.match(/MINE/g)).toHaveLength(2)
  })
})

function loginShellWith(homeDir: string, env: Record<string, string>, command: string): string {
  return stdoutOf(spawnLogin(homeDir, command, homeDir, env))
}

describe.skipIf(!existsSync(ZSH))('앱의 .zshenv 의 claude 함수', () => {
  const tty = it.skipIf(!existsSync(EXPECT))

  tty('앱 plugin 을 실어 claude 를 띄우고, 끝나면 tty 에 OSC 7501 clear 를 쓴다', () => {
    const h = home({ '.zshrc': '' })
    const { bin, log } = fakes(h, 'exit 0')
    const out = ttyShellWith(h, appEnv(bin), 'claude -p "a b"; print code=$?')
    expect(out).toContain(CLEAR)
    expect(out).toContain('code=0')
    expect(readFileSync(log, 'utf8')).toBe('claude --plugin-dir /plug -p a b\n')
  })

  tty('clear 는 stdout 이 아니라 tty 에 쓴다', () => {
    const h = home({ '.zshrc': '' })
    const { bin } = fakes(h, 'exit 0')
    const captured = join(h, 'stdout.txt')
    expect(ttyShellWith(h, appEnv(bin), `claude > '${captured}'`)).toContain(CLEAR)
    expect(readFileSync(captured, 'utf8')).toBe('')
  })

  it('tty 가 없으면 clear 를 건너뛰고 claude 의 종료 코드를 돌려준다', () => {
    const h = home({ '.zshrc': '' })
    const { bin } = fakes(h, 'exit 3')
    const r = spawnLogin(h, 'claude; print code=$?', h, appEnv(bin))
    expect(r.stdout).toBe('code=3\n')
    expect(r.stderr).toBe('')
  })

  tty('Ctrl-C 로 claude 와 함께 셸이 SIGINT 를 받아도 clear 를 쓴다', () => {
    const h = home({ '.zshrc': '' })
    const { bin } = fakes(h, 'kill -INT $PPID; kill -INT $$')
    expect(ttyShellWith(h, appEnv(bin), 'claude')).toContain(CLEAR)
  })

  tty('claude 가 SIGKILL 로 죽어도 clear 를 쓴다', () => {
    const h = home({ '.zshrc': '' })
    const { bin } = fakes(h, 'kill -9 $$')
    expect(ttyShellWith(h, appEnv(bin), 'claude')).toContain(CLEAR)
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
    expect(readFileSync(log, 'utf8')).toBe('claude --plugin-dir /plug --mine\n')
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

  tty(
    'claude 안(CLAUDECODE)에서 띄운 claude 는 plugin·env 없이 그대로 부르고 clear 를 쓰지 않는다',
    () => {
      const h = home({ '.zshrc': '' })
      const { bin, log } = fakes(h, recordHyperlink)
      const out = ttyShellWith(h, { ...appEnv(bin), CLAUDECODE: '1' }, 'claude --version')
      expect(out).not.toContain(CLEAR)
      expect(readFileSync(log, 'utf8')).toBe(
        'claude --version\nhyperlink=unset marker=unset zdotdir=unset\n'
      )
    }
  )

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
    expect(readFileSync(log, 'utf8')).toBe('claude --plugin-dir /plug --mine\n')
  })
})
