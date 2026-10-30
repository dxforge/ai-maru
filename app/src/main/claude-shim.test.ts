import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SHIM = join(__dirname, '../../resources/bin/claude')

type Setup = { dir: string; shimDir: string; realDir: string; log: string }

function setup(claudeTail = 'exit 0'): Setup {
  const dir = mkdtempSync(join(tmpdir(), 'maru-shim-'))
  const shimDir = join(dir, 'bin')
  const realDir = join(dir, 'real')
  const log = join(dir, 'calls.log')
  mkdirSync(shimDir)
  mkdirSync(realDir)
  copyFileSync(SHIM, join(shimDir, 'claude'))
  writeFileSync(
    join(realDir, 'claude'),
    [
      '#!/bin/sh',
      `{ echo "argv0=$0"; for a in "$@"; do echo "arg=$a"; done; ` +
        `echo "hyperlink=\${FORCE_HYPERLINK-unset} marker=\${MARU_CLAUDE_FORCED_HYPERLINK-unset} zdotdir=\${ZDOTDIR-unset}"; } > '${log}'`,
      claudeTail
    ].join('\n'),
    { mode: 0o755 }
  )
  return { dir, shimDir, realDir, log }
}

function appEnv(s: Setup, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: `${s.shimDir}:${s.realDir}:/usr/bin:/bin`,
    MARU_CLI: '/app/bin/maru',
    MARU_CLAUDE_PLUGIN: '/app/plugin',
    MARU_ZDOTDIR: '/app/zsh',
    SHELL: '/bin/zsh',
    ...extra
  }
}

function run(env: Record<string, string>, args: string[] = []) {
  return spawnSync('/bin/bash', ['-c', 'claude "$@"', 'bash', ...args], {
    env,
    encoding: 'utf8',
    timeout: 10_000
  })
}

const calls = (s: Setup) => readFileSync(s.log, 'utf8')

describe('앱의 claude shim', () => {
  it('앱 plugin 을 모든 인자 앞에 실어 PATH 의 다음 claude 를 부르고, 이름은 claude 로 남긴다', () => {
    const s = setup()
    expect(run(appEnv(s), ['-p', 'a b']).status).toBe(0)
    expect(calls(s)).toContain(
      `argv0=${s.realDir}/claude\narg=--plugin-dir\narg=/app/plugin\narg=-p\narg=a b\n`
    )
  })

  it('하위 명령도 앞에 둔 --plugin-dir 과 함께 넘긴다', () => {
    const s = setup()
    run(appEnv(s), ['mcp', 'list'])
    expect(calls(s)).toContain('arg=--plugin-dir\narg=/app/plugin\narg=mcp\narg=list\n')
  })

  it('자식으로 띄우지 않고 claude 로 바뀐다', () => {
    const s = setup('echo "pid=$$" >> "$0.pid"')
    const r = spawnSync('/bin/bash', ['-c', 'claude & echo "pid=$!"; wait'], {
      env: appEnv(s),
      encoding: 'utf8'
    })
    expect(readFileSync(join(s.realDir, 'claude.pid'), 'utf8')).toBe(r.stdout)
  })

  it('claude 의 종료 코드를 돌려준다', () => {
    const s = setup('exit 3')
    expect(run(appEnv(s)).status).toBe(3)
  })

  it.each([
    ['MARU_CLI', { MARU_CLI: '' }],
    ['MARU_CLAUDE_PLUGIN', { MARU_CLAUDE_PLUGIN: '' }],
    ['CLAUDECODE(claude 안)', { CLAUDECODE: '1' }]
  ])('%s 이면 plugin·env 없이 그대로 부른다', (_, extra) => {
    const s = setup()
    run(appEnv(s, extra), ['--version'])
    expect(calls(s)).toBe(
      `argv0=${s.realDir}/claude\narg=--version\nhyperlink=unset marker=unset zdotdir=unset\n`
    )
  })

  it('claude 에만 FORCE_HYPERLINK=1 과 표식, 앱 ZDOTDIR 을 붙인다', () => {
    const s = setup()
    run(appEnv(s))
    expect(calls(s)).toContain('hyperlink=1 marker=1 zdotdir=/app/zsh\n')
  })

  it.each(['0', ''])(
    '사용자가 FORCE_HYPERLINK 를 %j 로 정해 두었으면 그 값을 두고 표식도 붙이지 않는다',
    (value) => {
      const s = setup()
      run(appEnv(s, { FORCE_HYPERLINK: value }))
      expect(calls(s)).toContain(`hyperlink=${value} marker=unset zdotdir=unset\n`)
    }
  )

  it('SHELL 이 zsh 가 아니면 Bash 도구의 셸이 지우지 못하므로 FORCE_HYPERLINK 를 붙이지 않는다', () => {
    const s = setup()
    run(appEnv(s, { SHELL: '/bin/bash' }))
    expect(calls(s)).toContain('arg=--plugin-dir\n')
    expect(calls(s)).toContain('hyperlink=unset marker=unset zdotdir=unset\n')
  })

  it('심볼릭 링크로 PATH 에 다시 들어 있는 자기 디렉토리도 건너뛴다', () => {
    const s = setup()
    const link = join(s.dir, 'link')
    symlinkSync(s.shimDir, link)
    expect(run(appEnv(s, { PATH: `${link}:${s.shimDir}:${s.realDir}:/usr/bin:/bin` })).status).toBe(
      0
    )
    expect(calls(s)).toContain(`argv0=${s.realDir}/claude\n`)
  })

  it('다른 앱의 shim 사본이 PATH 에 함께 있어도 그것을 건너뛰고 진짜 claude 를 plugin 하나로 부른다', () => {
    const s = setup()
    const other = join(s.dir, 'other')
    mkdirSync(other)
    copyFileSync(SHIM, join(other, 'claude'))
    const r = run(appEnv(s, { PATH: `${s.shimDir}:${other}:${s.realDir}:/usr/bin:/bin` }), ['x'])
    expect(r.status).toBe(0)
    expect(calls(s)).toContain(
      `argv0=${s.realDir}/claude\narg=--plugin-dir\narg=/app/plugin\narg=x\nhyperlink=`
    )
  })

  it('자기 디렉토리와 이름의 앞부분만 같은 디렉토리는 건너뛰지 않는다', () => {
    const s = setup()
    const near = `${s.shimDir}x`
    mkdirSync(near)
    copyFileSync(join(s.realDir, 'claude'), join(near, 'claude'))
    run(appEnv(s, { PATH: `${s.shimDir}:${near}:${s.realDir}:/usr/bin:/bin` }))
    expect(calls(s)).toContain(`argv0=${near}/claude\n`)
  })

  it('다른 claude 가 없으면 stderr 에 알리고 127 로 끝난다', () => {
    const s = setup()
    const r = run(appEnv(s, { PATH: `${s.shimDir}:/usr/bin:/bin` }))
    expect(r.status).toBe(127)
    expect(r.stderr).toContain('claude: command not found')
  })
})
