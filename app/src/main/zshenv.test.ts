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
const plugin = join(__dirname, '../../resources/claude-plugin')
const shimDir = join(__dirname, '../../resources/bin')

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

  describe('앱 안(MARU_CLI 있음)에서', () => {
    const app = appEnv('/opt/maru')
    const run = (h: string, command: string) => shellWith(h, app, command)

    it('사용자의 ~/.zprofile·~/.zshrc·~/.zlogin 을 그 순서로 읽고, 끝나면 ZDOTDIR 이 없다', () => {
      const h = home({ '.zprofile': 'O=p', '.zshrc': 'O+=r', '.zlogin': 'O+=l' })
      expect(run(h, 'print $O ${ZDOTDIR-unset}')).toBe('prl unset\n')
    })

    it('사용자 시작 파일 안의 $0 는 zsh 가 직접 읽을 때처럼 셸 이름이고, 끝나면 function_argzero 가 켜져 있다', () => {
      const h = home({ '.zprofile': 'print $0', '.zshrc': 'print $0', '.zlogin': 'print $0' })
      expect(run(h, '[[ -o function_argzero ]] && print on')).toBe(`${ZSH}\n${ZSH}\n${ZSH}\non\n`)
    })

    it.skipIf(!existsSync('/etc/zshrc'))(
      '/etc/zshrc 가 정한 HISTFILE 은 사용자 자리를 가리킨다',
      () => {
        const h = home({ '.zshrc': '' })
        expect(run(h, 'print -r -- $HISTFILE')).toBe(`${h}/.zsh_history\n`)
      }
    )

    it('사용자 시작 파일은 사용자 ZDOTDIR 아래에서 돈다', () => {
      const h = home({ '.zshrc': 'print -r -- ${ZDOTDIR-unset}' })
      expect(run(h, 'true')).toBe('unset\n')
    })

    it('~/.zshenv 가 정한 ZDOTDIR 에서 나머지 시작 파일을 읽고, 그 값을 export 한 채 남긴다', () => {
      const h = home({
        '.zshenv': 'export ZDOTDIR=$HOME/cfg',
        'cfg/.zshrc': 'MARK=cfg',
        '.zshrc': 'MARK=home'
      })
      expect(run(h, 'print $MARK ${ZDOTDIR#$HOME/}; zsh -fc "print \\$ZDOTDIR"')).toBe(
        `cfg cfg\n${h}/cfg\n`
      )
    })
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

  it('claude shim 디렉토리(plugin 옆 bin)를 maru 디렉토리 바로 뒤에 둔다', () => {
    expect(atPrompt(pushedBack(), ['print -l $path[1,2]'], appEnv(bin))).toBe(
      `${bin}\n${shimDir}\n`
    )
  })

  it('설치본처럼 claude shim 이 maru 와 같은 디렉토리면 한 번만 둔다', () => {
    expect(atPrompt(pushedBack(), ['print -l $path[1,2]'], appEnv(shimDir))).toBe(
      `${shimDir}\n/opt/first\n`
    )
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
    expect(atPrompt(h, ['print $PATH'], appEnv(bin))).toBe(
      `${bin}:${shimDir}:/opt/mine:/usr/bin:/bin\n`
    )
  })

  it('이미 PATH 에 있는 maru·claude shim 디렉토리는 앞으로 옮기고 두 번 넣지 않는다', () => {
    const h = pushedBack({ '.zshrc': `export PATH=/opt/mine:${shimDir}:${bin}:/usr/bin:/bin` })
    expect(atPrompt(h, ['print $PATH'], appEnv(bin))).toBe(
      `${bin}:${shimDir}:/opt/mine:/usr/bin:/bin\n`
    )
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

function fakes(dir: string): { log: string; env: Record<string, string> } {
  const bin = join(dir, 'fakebin')
  const real = join(dir, 'real')
  const log = join(dir, 'calls.log')
  mkdirSync(bin, { recursive: true })
  mkdirSync(real, { recursive: true })
  writeFileSync(join(real, 'claude'), `#!/bin/sh\necho "claude $*" >> '${log}'\n`, { mode: 0o755 })
  writeFileSync(join(bin, 'maru'), '#!/bin/sh\n', { mode: 0o755 })
  const env = { ...appEnv(bin), PATH: `${bin}:${shimDir}:${real}:/usr/bin:/bin` }
  return { log, env }
}

function appEnv(bin: string): Record<string, string> {
  return { PATH: `${bin}:/usr/bin:/bin`, MARU_CLI: join(bin, 'maru'), MARU_CLAUDE_PLUGIN: plugin }
}

function shellWith(homeDir: string, env: Record<string, string>, command: string): string {
  return stdoutOf(spawnLogin(homeDir, command, homeDir, env))
}

const EXPECT = '/usr/bin/expect'

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

  // exec 로 바뀐 zsh 는 앱의 .zshenv 를 읽지 않으므로 OSC 133 을 보내지 않는다.
  it.each([
    'exec zsh',
    'true && exec zsh',
    'false || exec zsh',
    'FOO=1 exec zsh',
    '{ exec zsh }',
    'if true; then exec zsh; fi',
    'case x in (x) exec zsh ;; esac',
    'builtin exec zsh',
    'noglob exec zsh',
    '- exec zsh',
    '() { exec zsh }'
  ])('명령 자리의 exec 가 명령을 받는 %s 에는 C 를 보내지 않는다', (command) => {
    expect(marks(ttyPrompt({}, [command]))).toEqual(['A'])
  })

  it('alias 가 펴져 exec 가 되면 C 를 보내지 않고, 명령 텍스트는 친 그대로 싣는다', () => {
    const zshrc = "alias reload='exec zsh' again=reload greet='print hi'"
    expect(marks(ttyPrompt({ '.zshrc': zshrc }, ['greet', 'again']))).toEqual([
      'A',
      'C;cmdline_url=greet',
      'D;0',
      'A'
    ])
  })

  it('앞 명령 뒤의 exec 가 명령을 받으면 그 줄에는 C 를 보내지 않는다', () => {
    const exec = 'print x; exec bash --norc --noprofile'
    expect(marks(ttyPrompt({}, ['export PS1', exec]))).toEqual([
      'A',
      'C;cmdline_url=export%20PS1',
      'D;0',
      'A'
    ])
  })

  it('리다이렉션만 받은 exec, 명령 자리가 아닌 exec, 서브셸과 함수 정의 안의 exec 에는 C 와 D 를 보낸다', () => {
    const commands = [
      'exec 2>err',
      'exec {fd}>out 3<&-',
      'print exec zsh',
      '( true; exec true )',
      'f() { true; exec zsh }',
      'function g { { exec zsh } }; print done'
    ]
    expect(marks(ttyPrompt({}, commands))).toEqual([
      'A',
      ...commands.flatMap((c) => [startOf(c), 'D;0', 'A']),
      'C;cmdline_url=exit'
    ])
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

describe.skipIf(!existsSync(ZSH))('앱의 .zshenv 와 claude shim', () => {
  it('셸에는 claude 함수가 없고, PATH 의 shim 을 거쳐 앱 plugin 을 싣는다', () => {
    const h = home({ '.zshrc': '' })
    const { log, env } = fakes(h)
    expect(shellWith(h, env, 'whence -w claude')).toBe('claude: command\n')
    shellWith(h, env, 'claude -p "a b"')
    expect(readFileSync(log, 'utf8')).toBe(`claude --plugin-dir ${plugin} -p a b\n`)
  })

  it.each([
    ['command claude', 'command claude x'],
    ['exec claude', 'exec claude x'],
    ['새로 연 zsh', `${ZSH} -c 'claude x'`]
  ])('%s 도 앱 plugin 을 싣는다', (_, command) => {
    const h = home({ '.zshrc': '' })
    const { log, env } = fakes(h)
    shellWith(h, env, command)
    expect(readFileSync(log, 'utf8')).toBe(`claude --plugin-dir ${plugin} x\n`)
  })

  it('런처처럼 -c 로 받은 claude 도, 사용자 ~/.zshrc 가 진짜 claude 디렉토리를 PATH 앞에 붙이면 shim 을 거친다', () => {
    const h = home({ '.zshrc': 'path=($HOME/real $path)' })
    const { log, env } = fakes(h)
    const r = spawnZsh(['-c', '"$@"', 'zsh', 'claude', 'x'], h, h, env)
    expect(r.status).toBe(0)
    expect(readFileSync(log, 'utf8')).toBe(`claude --plugin-dir ${plugin} x\n`)
  })

  it('사용자 alias 를 거쳐도 앱 plugin 이 실린다', () => {
    const h = home({ '.zshrc': "alias claude='claude --mine'" })
    const { log, env } = fakes(h)
    shellWith(h, env, 'claude')
    expect(readFileSync(log, 'utf8')).toBe(`claude --plugin-dir ${plugin} --mine\n`)
  })

  it('사용자 .zshrc 가 정의한 claude 함수가 이긴다', () => {
    const h = home({ '.zshrc': 'claude() { print mine }' })
    const { env } = fakes(h)
    expect(shellWith(h, env, 'claude')).toBe('mine\n')
  })

  it('claude 의 Bash 도구가 띄우는 로그인 셸은 표식을 보고 FORCE_HYPERLINK 를 지운다', () => {
    const h = home({ '.zshrc': '' })
    const forced = { FORCE_HYPERLINK: '1', MARU_CLAUDE_FORCED_HYPERLINK: '1' }
    const print =
      'print ${FORCE_HYPERLINK-unset} ${MARU_CLAUDE_FORCED_HYPERLINK-unset} ${ZDOTDIR-unset}'
    expect(shellWith(h, forced, print)).toBe('unset unset unset\n')
    // 표식이 없으면 사용자가 정한 값이라 둔다.
    expect(shellWith(h, { FORCE_HYPERLINK: '1' }, print)).toBe('1 unset unset\n')
  })
})
