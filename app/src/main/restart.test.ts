import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { STATE_VERSIONS } from '../shared/screen'
import { socketPath } from './pty'
import {
  checkRestart,
  installedVersions,
  ptyProtocol,
  rendererGoneDialog,
  restartDialog,
  restartOutcome,
  restartRefusal,
  type Incompatible
} from './restart'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maru-restart-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function fakeBin(output: string): string {
  const bin = join(dir, 'maru-pty')
  writeFileSync(bin, `#!/bin/sh\necho ${output}\n`)
  chmodSync(bin, 0o755)
  return bin
}

function versions(v: object | string): string {
  const file = join(dir, 'state-versions.json')
  writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v))
  return file
}

async function livePty(d: string, id: string): Promise<Server> {
  const server = createServer((s) => s.destroy())
  await new Promise<void>((r) => server.listen(socketPath(d, id), r))
  writeFileSync(
    join(d, `${id}.json`),
    JSON.stringify({ protocol_version: PROTOCOL_VERSION, id, pid: process.pid })
  )
  return server
}

describe('ptyProtocol', () => {
  it('바이너리가 알려 준 버전을 읽고, 못 읽으면 null 이다', async () => {
    expect(await ptyProtocol(fakeBin('7'))).toBe(7)
    expect(await ptyProtocol(fakeBin('nope'))).toBeNull()
    expect(await ptyProtocol(fakeBin(''))).toBeNull()
    expect(await ptyProtocol(join(dir, 'missing'))).toBeNull()
  })
})

describe('installedVersions', () => {
  it('부분마다의 버전이 모두 정수면 읽고, 파일이 없거나 틀리거나 pins 가 없는 옛 빌드의 파일이면 null 이다', async () => {
    const all = { layout: 2, sessions: 1, view: 3, pins: 4 }
    expect(await installedVersions(versions({ ...all, x: 1 }))).toEqual(all)
    expect(await installedVersions(versions({ layout: 2, sessions: 1, view: 3 }))).toBeNull()
    expect(await installedVersions(versions('{nope'))).toBeNull()
    expect(await installedVersions(join(dir, 'missing.json'))).toBeNull()
  })
})

describe('checkRestart', () => {
  const same = (): string => versions(STATE_VERSIONS)
  const check = (bin: string, versionsFile: string, d = join(dir, 'run')) =>
    checkRestart({ devServer: false, bin, versionsFile, dir: d })

  it('dev 서버로 띄웠으면 재시작하지 않는다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION))
    expect(
      await checkRestart({ devServer: true, bin, versionsFile: same(), dir: join(dir, 'run') })
    ).toEqual({ ok: false, reason: 'dev_server' })
  })

  it('프로토콜과 형식 버전이 같으면 재시작한다', async () => {
    expect(await check(fakeBin(String(PROTOCOL_VERSION)), same())).toEqual({ ok: true })
  })

  it('프로토콜이 달라도 산 pty 가 없으면 재시작한다', async () => {
    expect(await check(fakeBin(String(PROTOCOL_VERSION + 1)), same())).toEqual({ ok: true })
  })

  it('view 버전만 다르면 묻지 않는다', async () => {
    const file = versions({ ...STATE_VERSIONS, view: STATE_VERSIONS.view + 1 })
    expect(await check(fakeBin(String(PROTOCOL_VERSION)), file)).toEqual({ ok: true })
  })

  it('프로토콜이 다르고 산 pty 가 있으면 레이아웃만 복원한다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'maru-live-'))
    const server = await livePty(d, 'p-0000000a')
    try {
      expect(await check(fakeBin(String(PROTOCOL_VERSION + 1)), same(), d)).toEqual({
        ok: false,
        reason: 'incompatible',
        result: 'layout',
        ptys: 1,
        protocol: PROTOCOL_VERSION + 1,
        formats: []
      })
    } finally {
      server.close()
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('sessions 형식이 다르면 산 pty 가 없어도 레이아웃만 복원한다', async () => {
    const file = versions({ ...STATE_VERSIONS, sessions: STATE_VERSIONS.sessions + 1 })
    expect(await check(fakeBin(String(PROTOCOL_VERSION)), file)).toEqual({
      ok: false,
      reason: 'incompatible',
      result: 'layout',
      ptys: 0,
      formats: ['sessions']
    })
  })

  it('pins 형식만 다르면 pty 에 다시 붙는 복원이고, 꺼질 pty 는 없다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'maru-live-'))
    const server = await livePty(d, 'p-0000000a')
    try {
      const file = versions({ ...STATE_VERSIONS, pins: STATE_VERSIONS.pins + 1 })
      expect(await check(fakeBin(String(PROTOCOL_VERSION)), file, d)).toEqual({
        ok: false,
        reason: 'incompatible',
        result: 'full',
        ptys: 0,
        formats: ['pins']
      })
    } finally {
      server.close()
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('layout 형식이 다르거나 형식 버전 파일이 없으면 cell 을 모두 닫는다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION))
    const file = versions({ ...STATE_VERSIONS, layout: STATE_VERSIONS.layout + 1 })
    expect(await check(bin, file)).toMatchObject({ result: 'empty', formats: ['layout'] })
    expect(await check(bin, join(dir, 'missing.json'))).toMatchObject({
      result: 'empty',
      formats: ['layout', 'sessions', 'pins'],
      formatsUnknown: true
    })
    expect(
      restartDialog((await check(bin, join(dir, 'missing.json'))) as Incompatible).detail
    ).toBe(
      "The installed app's saved-state format couldn't be determined. All cells will close. Pinned workspaces will be unpinned and lose their custom names and favorites. Those with no cells will be removed."
    )
  })
})

describe('restartOutcome', () => {
  const incompatible = (
    result: Incompatible['result'],
    formats: Incompatible['formats'] = []
  ): Incompatible => ({ ok: false, reason: 'incompatible', result, ptys: 0, formats })

  it('pins 만 잃는 재시작은 pty 를 남긴다', () => {
    expect(restartOutcome({ ok: true })).toEqual({ outcome: 'keep', dropPins: false })
    expect(restartOutcome(incompatible('full', ['pins']))).toEqual({
      outcome: 'keep',
      dropPins: true
    })
    expect(restartOutcome(incompatible('layout', ['sessions']))).toEqual({
      outcome: 'layout',
      dropPins: false
    })
    expect(restartOutcome(incompatible('empty', ['layout']))).toEqual({
      outcome: 'end',
      dropPins: false
    })
  })

  it('pins 형식이 다르면 어느 결과든 pins 를 비운다 — 다시 뜬 앱이 읽지 못한 pins 를 알리지 않게', () => {
    expect(restartOutcome(incompatible('layout', ['sessions', 'pins'])).dropPins).toBe(true)
    expect(restartOutcome(incompatible('empty', ['layout', 'sessions', 'pins'])).dropPins).toBe(
      true
    )
  })
})

describe('restartDialog · restartRefusal', () => {
  const protocol: Incompatible = {
    ok: false,
    reason: 'incompatible',
    result: 'layout',
    ptys: 2,
    protocol: 9,
    formats: []
  }
  const layout: Incompatible = {
    ok: false,
    reason: 'incompatible',
    result: 'empty',
    ptys: 1,
    formats: ['layout', 'sessions']
  }
  const pins: Incompatible = {
    ok: false,
    reason: 'incompatible',
    result: 'full',
    ptys: 0,
    formats: ['pins']
  }

  it('결과에 맞는 버튼과 이유를 준다', () => {
    expect(restartDialog(protocol)).toEqual({
      message: 'Restart with layout only?',
      detail: `The installed app uses pty protocol version 9, while this app uses version ${PROTOCOL_VERSION}. This will end 2 terminals. The panes will reopen with new shells in their last directories.`,
      buttons: ['Restart with layout only', 'Cancel']
    })
    expect(restartDialog(layout).buttons).toEqual(['Restart and close all cells', 'Cancel'])
    expect(restartDialog(layout).detail).toBe(
      'The installed app uses a different format for the saved layout and terminal sessions. This will end 1 terminal. All cells will close.'
    )
    expect(restartDialog(pins)).toEqual({
      message: 'Restart without workspace pins?',
      detail:
        'The installed app uses a different format for the saved workspace pins. Pinned workspaces will be unpinned and lose their custom names and favorites. Those with no cells will be removed.',
      buttons: ['Restart without workspace pins', 'Cancel']
    })
    expect(restartDialog({ ...layout, formats: ['layout', 'sessions', 'pins'] }).detail).toMatch(
      /^The installed app uses a different format for the saved layout, terminal sessions and workspace pins\./
    )
  })

  it('CLI 메시지는 플래그를 주면 어떻게 되는지 적는다', () => {
    expect(restartRefusal(protocol).message).toMatch(
      /Pass --kill-ptys to restart with the layout only\.$/
    )
    expect(restartRefusal(layout).message).toMatch(
      /Pass --kill-ptys to restart and close all cells\.$/
    )
    expect(restartRefusal(pins).message).toMatch(
      /Pass --kill-ptys to restart without workspace pins\.$/
    )
  })

  it('pty 를 끄지 않고 pins 만 잃으면 pins_would_be_lost 로 거절한다', () => {
    expect(restartRefusal(pins).code).toBe('pins_would_be_lost')
    expect(restartRefusal(protocol).code).toBe('ptys_would_end')
    expect(restartRefusal(layout).code).toBe('ptys_would_end')
  })
})

describe('rendererGoneDialog', () => {
  const gone = { reason: 'oom', exitCode: 9 }

  it('재시작할 수 있으면 Restart 와 Quit 을 주고 죽은 이유를 적는다', () => {
    const d = rendererGoneDialog(gone, true)
    expect(d.choices).toEqual(['restart', 'quit'])
    expect(d.buttons).toHaveLength(2)
    expect(d.choices[d.cancelId]).toBe('quit')
    expect(d.detail).toContain('reason: oom; exit code: 9')
  })

  it('dev server 가 띄운 앱이면 Restart 없이 Quit 과 그대로 두기만 준다', () => {
    const d = rendererGoneDialog(gone, false)
    expect(d.choices).toEqual(['quit', null])
    expect(d.buttons).toHaveLength(2)
    expect(d.choices[d.cancelId]).toBeNull()
    expect(d.detail).toContain('reason: oom; exit code: 9')
  })
})
