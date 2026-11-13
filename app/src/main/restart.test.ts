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
  ptyProtocolRange,
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

/** `min` 이 없으면 `--min-protocol-version` 을 모르는 빌드처럼 실패한다. */
function fakeBin(output: string, min?: string): string {
  const bin = join(dir, 'maru-pty')
  const lowest = min === undefined ? 'exit 2' : `echo ${min}`
  writeFileSync(
    bin,
    `#!/bin/sh\ncase "$1" in --min-protocol-version) ${lowest} ;; *) echo ${output} ;; esac\n`
  )
  chmodSync(bin, 0o755)
  return bin
}

function versions(v: object | string): string {
  const file = join(dir, 'state-versions.json')
  writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v))
  return file
}

async function livePty(d: string, id: string, protocol = PROTOCOL_VERSION): Promise<Server> {
  const server = createServer((s) => s.destroy())
  await new Promise<void>((r) => server.listen(socketPath(d, id), r))
  writeFileSync(
    join(d, `${id}.json`),
    JSON.stringify({ protocol_version: protocol, id, pid: process.pid })
  )
  return server
}

describe('ptyProtocolRange', () => {
  it('바이너리가 알려 준 두 버전을 읽고, 버전을 못 읽으면 null 이다', async () => {
    expect(await ptyProtocolRange(fakeBin('7', '5'))).toEqual({ min: 5, max: 7 })
    expect(await ptyProtocolRange(fakeBin('nope', '5'))).toBeNull()
    expect(await ptyProtocolRange(fakeBin('', '5'))).toBeNull()
    expect(await ptyProtocolRange(join(dir, 'missing'))).toBeNull()
  })

  it('하한을 모르거나 버전보다 높으면 하한을 버전으로 본다', async () => {
    expect(await ptyProtocolRange(fakeBin('7'))).toEqual({ min: 7, max: 7 })
    expect(await ptyProtocolRange(fakeBin('7', 'nope'))).toEqual({ min: 7, max: 7 })
    expect(await ptyProtocolRange(fakeBin('7', '8'))).toEqual({ min: 7, max: 7 })
  })
})

describe('installedVersions', () => {
  it('표마다의 버전이 모두 정수면 읽고, 파일이 없거나 틀리거나 표가 빠진 옛 빌드의 파일이면 null 이다', async () => {
    const all = { workspaces: 1, cells: 2, panes: 3, sessions: 4, view: 5 }
    expect(await installedVersions(versions({ ...all, x: 1 }))).toEqual(all)
    expect(
      await installedVersions(versions({ layout: 2, sessions: 1, view: 3, pins: 1 }))
    ).toBeNull()
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

  it('설치본이 받는 범위 밖인 산 pty 가 있으면 레이아웃만 복원한다 — 하한을 모르는 설치본은 자기 버전만 받는다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'maru-live-'))
    const server = await livePty(d, 'p-0000000a')
    try {
      expect(await check(fakeBin(String(PROTOCOL_VERSION + 1)), same(), d)).toEqual({
        ok: false,
        reason: 'incompatible',
        result: 'layout',
        ptys: 1,
        recovered: 0,
        protocol: [PROTOCOL_VERSION],
        kept: [],
        formats: []
      })
    } finally {
      server.close()
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('설치본의 버전이 달라도 산 pty 가 그 범위 안이면 재시작한다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'maru-live-'))
    const server = await livePty(d, 'p-0000000a')
    try {
      const bin = fakeBin(String(PROTOCOL_VERSION + 1), String(PROTOCOL_VERSION))
      expect(await check(bin, same(), d)).toEqual({ ok: true })
    } finally {
      server.close()
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('범위 밖 pty 만 끈다고 세고, 범위 안 pty 는 남겨 Recovered 로 옮긴다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'maru-live-'))
    const inside = await livePty(d, 'p-0000000a')
    const below = await livePty(d, 'p-0000000b', PROTOCOL_VERSION - 1)
    const above = await livePty(d, 'p-0000000c', PROTOCOL_VERSION + 2)
    const again = await livePty(d, 'p-0000000d', PROTOCOL_VERSION - 1)
    try {
      const bin = fakeBin(String(PROTOCOL_VERSION + 1), String(PROTOCOL_VERSION))
      expect(await check(bin, same(), d)).toEqual({
        ok: false,
        reason: 'incompatible',
        result: 'layout',
        ptys: 3,
        recovered: 1,
        protocol: [PROTOCOL_VERSION - 1, PROTOCOL_VERSION + 2],
        kept: ['p-0000000a'],
        formats: []
      })
    } finally {
      for (const s of [inside, below, above, again]) s.close()
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('설치본의 버전을 알 수 없으면 산 pty 를 모두 끈다고 센다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'maru-live-'))
    const server = await livePty(d, 'p-0000000a')
    try {
      expect(await check(fakeBin('nope', String(PROTOCOL_VERSION)), same(), d)).toEqual({
        ok: false,
        reason: 'incompatible',
        result: 'layout',
        ptys: 1,
        recovered: 0,
        protocol: null,
        kept: [],
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
      recovered: 0,
      formats: ['sessions']
    })
  })

  it('workspaces 형식만 다르면 pty 에 다시 붙는 복원이고, 꺼질 pty 는 없다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'maru-live-'))
    const server = await livePty(d, 'p-0000000a')
    try {
      const file = versions({ ...STATE_VERSIONS, workspaces: STATE_VERSIONS.workspaces + 1 })
      expect(await check(fakeBin(String(PROTOCOL_VERSION)), file, d)).toEqual({
        ok: false,
        reason: 'incompatible',
        result: 'full',
        ptys: 0,
        recovered: 0,
        formats: ['workspaces']
      })
    } finally {
      server.close()
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('panes 형식이 다르면 cell 마다 셸 하나로 열고, 산 pty 는 끄지 않고 Recovered 로 옮긴다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'maru-live-'))
    const server = await livePty(d, 'p-0000000a')
    try {
      const file = versions({ ...STATE_VERSIONS, panes: STATE_VERSIONS.panes + 1 })
      expect(await check(fakeBin(String(PROTOCOL_VERSION)), file, d)).toEqual({
        ok: false,
        reason: 'incompatible',
        result: 'cells',
        ptys: 0,
        recovered: 1,
        formats: ['panes']
      })
    } finally {
      server.close()
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('cells 형식이 다르거나 형식 버전 파일이 없으면 cell 을 모두 닫는다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION))
    const file = versions({ ...STATE_VERSIONS, cells: STATE_VERSIONS.cells + 1 })
    expect(await check(bin, file)).toMatchObject({ result: 'empty', formats: ['cells'] })
    expect(await check(bin, join(dir, 'missing.json'))).toMatchObject({
      result: 'empty',
      formats: ['workspaces', 'cells', 'panes', 'sessions'],
      formatsUnknown: true
    })
    expect(
      restartDialog((await check(bin, join(dir, 'missing.json'))) as Incompatible).detail
    ).toBe(
      "The installed app's saved-state format couldn't be determined. All cells will close. Workspaces will lose their custom names, favorites and Keep Workspace. Workspaces without cells will be removed."
    )
  })
})

describe('restartOutcome', () => {
  const incompatible = (
    result: Incompatible['result'],
    formats: Incompatible['formats'] = []
  ): Incompatible => ({ ok: false, reason: 'incompatible', result, ptys: 0, recovered: 0, formats })

  it('프로토콜이 같으면 pty 를 남기고, 형식이 다른 표는 결과와 상관없이 비운다 — 다시 뜬 앱이 읽지 못한 표를 알리지 않게', () => {
    expect(restartOutcome({ ok: true })).toEqual({ outcome: 'keep', drop: [], keep: [] })
    expect(restartOutcome({ ok: false, reason: 'dev_server' })).toEqual({
      outcome: 'layout',
      drop: [],
      keep: []
    })
    expect(restartOutcome(incompatible('full', ['workspaces']))).toEqual({
      outcome: 'keep',
      drop: ['workspaces'],
      keep: []
    })
    expect(restartOutcome(incompatible('layout', ['sessions']))).toEqual({
      outcome: 'keep',
      drop: ['sessions'],
      keep: []
    })
    expect(restartOutcome(incompatible('cells', ['workspaces', 'panes']))).toEqual({
      outcome: 'keep',
      drop: ['workspaces', 'panes'],
      keep: []
    })
    expect(restartOutcome(incompatible('empty', ['cells']))).toEqual({
      outcome: 'keep',
      drop: ['cells'],
      keep: []
    })
  })

  it('설치본이 붙지 못하는 pty 가 있으면 pty 를 끄는 결과를 고르고, 붙을 수 있는 pty 만 남긴다', () => {
    const differs = (
      result: Incompatible['result'],
      formats: Incompatible['formats'] = []
    ): Incompatible => ({
      ...incompatible(result, formats),
      protocol: [PROTOCOL_VERSION - 1],
      kept: ['p-0000000a']
    })
    expect(restartOutcome(differs('layout'))).toEqual({
      outcome: 'layout',
      drop: [],
      keep: ['p-0000000a']
    })
    expect(restartOutcome(differs('cells', ['panes']))).toEqual({
      outcome: 'layout',
      drop: ['panes'],
      keep: ['p-0000000a']
    })
    expect(restartOutcome(differs('empty', ['cells']))).toEqual({
      outcome: 'end',
      drop: ['cells'],
      keep: ['p-0000000a']
    })
  })
})

describe('restartDialog · restartRefusal', () => {
  const protocol: Incompatible = {
    ok: false,
    reason: 'incompatible',
    result: 'layout',
    ptys: 2,
    recovered: 0,
    protocol: [3],
    kept: [],
    formats: []
  }
  const layout: Incompatible = {
    ok: false,
    reason: 'incompatible',
    result: 'empty',
    ptys: 0,
    recovered: 1,
    formats: ['cells', 'sessions']
  }
  const panes: Incompatible = {
    ok: false,
    reason: 'incompatible',
    result: 'cells',
    ptys: 0,
    recovered: 2,
    formats: ['panes']
  }
  const details: Incompatible = {
    ok: false,
    reason: 'incompatible',
    result: 'full',
    ptys: 0,
    recovered: 0,
    formats: ['workspaces']
  }

  it('결과에 맞는 버튼과 이유를 준다', () => {
    expect(restartDialog(protocol)).toEqual({
      message: 'Restart with layout only?',
      detail:
        "The installed app can't reattach to terminals that use pty protocol version 3. This will end 2 terminals. The panes will reopen with new shells in their last directories.",
      buttons: ['Restart with layout only', 'Cancel']
    })
    expect(
      restartDialog({ ...protocol, protocol: [3, 7, 9], recovered: 1, kept: ['p-0000000a'] }).detail
    ).toBe(
      "The installed app can't reattach to terminals that use pty protocol versions 3, 7 and 9. This will end 2 terminals. The panes will reopen with new shells in their last directories. 1 terminal will keep running in a new workspace named Recovered."
    )
    expect(restartDialog({ ...protocol, protocol: null }).detail).toBe(
      `The installed app's pty protocol version couldn't be determined (this app uses version ${PROTOCOL_VERSION}). This will end 2 terminals. The panes will reopen with new shells in their last directories.`
    )
    expect(restartDialog({ ...protocol, protocol: [] }).detail).toMatch(
      /^The installed app can't reattach to terminals whose pty protocol version is unknown\. /
    )
    expect(restartDialog(layout).buttons).toEqual(['Restart and close all cells', 'Cancel'])
    expect(restartDialog(layout).detail).toBe(
      'The installed app uses a different saved-state format for the cells and terminal sessions. All cells will close. 1 terminal will keep running in a new workspace named Recovered.'
    )
    expect(restartDialog(panes)).toEqual({
      message: 'Restart with one shell per cell?',
      detail:
        'The installed app uses a different saved-state format for the panes. Each cell will reopen with one new shell. 2 terminals will keep running in a new workspace named Recovered.',
      buttons: ['Restart with one shell per cell', 'Cancel']
    })
    expect(restartDialog(details)).toEqual({
      message: 'Restart and lose workspace details?',
      detail:
        'The installed app uses a different saved-state format for the workspaces. Workspaces will lose their custom names, favorites and Keep Workspace. Workspaces without cells will be removed.',
      buttons: ['Restart and lose workspace details', 'Cancel']
    })
    expect(
      restartDialog({ ...layout, formats: ['workspaces', 'cells', 'sessions'] }).detail
    ).toMatch(
      /^The installed app uses a different saved-state format for the workspaces, cells and terminal sessions\./
    )
  })

  it('CLI 메시지는 플래그를 주면 어떻게 되는지 적는다', () => {
    expect(restartRefusal(protocol).message).toMatch(
      /Pass --kill-ptys to restart with the layout only\.$/
    )
    expect(restartRefusal(layout).message).toMatch(
      /Pass --kill-ptys to restart and close all cells\.$/
    )
    expect(restartRefusal(panes).message).toMatch(
      /Pass --kill-ptys to restart with one shell per cell\.$/
    )
    expect(restartRefusal(details).message).toMatch(
      /Pass --kill-ptys to restart and lose workspace details\.$/
    )
  })

  it('pty 를 끌 때만 ptys_would_end, 배치를 잃으면 layout_would_be_lost, workspaces 표만 잃으면 workspace_details_would_be_lost 로 거절한다', () => {
    expect(restartRefusal(details).code).toBe('workspace_details_would_be_lost')
    expect(restartRefusal(protocol).code).toBe('ptys_would_end')
    expect(restartRefusal(layout).code).toBe('layout_would_be_lost')
    expect(restartRefusal(panes).code).toBe('layout_would_be_lost')
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
