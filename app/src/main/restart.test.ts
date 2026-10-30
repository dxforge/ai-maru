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
  restartDialog,
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
  it('세 버전이 모두 정수면 읽고, 파일이 없거나 틀리면 null 이다', async () => {
    expect(await installedVersions(versions({ layout: 2, sessions: 1, view: 3, x: 1 }))).toEqual({
      layout: 2,
      sessions: 1,
      view: 3
    })
    expect(await installedVersions(versions({ layout: 2, sessions: 1 }))).toBeNull()
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

  it('layout 형식이 다르거나 형식 버전 파일이 없으면 빈 화면이다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION))
    const file = versions({ ...STATE_VERSIONS, layout: STATE_VERSIONS.layout + 1 })
    expect(await check(bin, file)).toMatchObject({ result: 'empty', formats: ['layout'] })
    expect(await check(bin, join(dir, 'missing.json'))).toMatchObject({
      result: 'empty',
      formats: ['layout', 'sessions'],
      formatsUnknown: true
    })
    expect(
      restartDialog((await check(bin, join(dir, 'missing.json'))) as Incompatible).detail
    ).toBe(
      "The installed app's saved-state format couldn't be determined. The app will start with an empty screen."
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

  it('결과에 맞는 버튼과 이유를 준다', () => {
    expect(restartDialog(protocol)).toEqual({
      message: 'Restart with layout only?',
      detail: `The installed app uses pty protocol version 9, while this app uses version ${PROTOCOL_VERSION}. This will end 2 terminals. The panes will reopen with new shells in their last directories.`,
      buttons: ['Restart with layout only', 'Cancel']
    })
    expect(restartDialog(layout).buttons).toEqual(['Restart with an empty screen', 'Cancel'])
    expect(restartDialog(layout).detail).toBe(
      'The installed app uses a different format for the saved layout and terminal sessions. This will end 1 terminal. The app will start with an empty screen.'
    )
  })

  it('CLI 메시지는 플래그를 주면 어떻게 되는지 적는다', () => {
    expect(restartRefusal(protocol)).toMatch(/Pass --kill-ptys to restart with the layout only\.$/)
    expect(restartRefusal(layout)).toMatch(/Pass --kill-ptys to restart with an empty screen\.$/)
  })
})
