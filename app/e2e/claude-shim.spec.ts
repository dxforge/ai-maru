import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, run, test, zshHome } from './app'

function fakeClaude(dataDir: string): { env: Record<string, string>; calls: () => string[] } {
  const bin = join(dataDir, 'fakebin')
  mkdirSync(bin)
  const log = join(dataDir, 'calls.log')
  writeFileSync(log, '')
  writeFileSync(
    join(bin, 'claude'),
    [
      '#!/bin/sh',
      `if [ "$1" = --plugin-dir ] && [ "$2" = "$MARU_CLAUDE_PLUGIN" ] && [ -f "$2/hooks/hooks.json" ]; then`,
      `  echo "plugin-ok $3" >> '${log}'`,
      'else',
      `  echo "plugin-missing $*" >> '${log}'`,
      'fi'
    ].join('\n'),
    { mode: 0o755 }
  )
  return {
    env: { PATH: `${bin}:${process.env.PATH}` },
    calls: () => readFileSync(log, 'utf8').trim().split('\n')
  }
}

test('zsh pane 에서 스크립트·exec·command 로 띄운 claude 와 새로 연 zsh 안의 claude 에도 앱 plugin 이 실린다', async ({
  launch,
  dataDir
}) => {
  const claude = fakeClaude(dataDir)
  const { page } = await launch({ ...claude.env, SHELL: '/bin/zsh', HOME: zshHome(dataDir) })
  await run(page, "bash -c 'claude script'; echo ran-$((1+1))", 'ran-2')
  await run(page, '(exec claude exec); echo ran-$((2+1))', 'ran-3')
  await run(page, 'command claude command; echo ran-$((3+1))', 'ran-4')
  await run(page, 'zsh -i', '%')
  await run(page, 'claude nested; exit', 'exit')
  await run(page, 'echo ran-$((4+1))', 'ran-5')
  expect(claude.calls()).toEqual([
    'plugin-ok script',
    'plugin-ok exec',
    'plugin-ok command',
    'plugin-ok nested'
  ])
})

test('bash pane 에서 띄운 claude 에도 앱 plugin 이 실린다', async ({ launch, dataDir }) => {
  const claude = fakeClaude(dataDir)
  const { page } = await launch(claude.env)
  await run(page, 'claude bash; echo ran-$((1+1))', 'ran-2')
  expect(claude.calls()).toEqual(['plugin-ok bash'])
})
