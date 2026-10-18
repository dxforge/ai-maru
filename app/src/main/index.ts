import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  nativeTheme,
  screen,
  shell,
  utilityProcess,
  type UtilityProcess
} from 'electron'
import { canvasPut } from './canvas'
import { createClaudeStatus } from './claude-status'
import { AfterReply, CliError, InvalidParams, listenCli, type Handlers } from './cli-server'
import { gitHead } from './git'
import { createInbox } from './inbox'
import { installCommandMenu } from './menu'
import { createMonitor } from './monitor'
import { isDevReload } from './navigation'
import { createPanes } from './pane'
import {
  checkRestart,
  restartFile,
  screenSessions,
  takeScreen,
  writeScreen,
  type RestartCheck
} from './restart'
import {
  appSocketPath,
  killSessions,
  readRecord,
  sessionLive,
  utf8Locale,
  type CliAccess
} from './session'
import type { KillRequest, OpenRequest } from './session-host'
import { createSessionWorkspaces } from './session-workspaces'
import {
  readWindowState,
  restoreWindowState,
  saveWindowStateOnClose,
  windowBounds
} from './window-state'
import type { PaneReply } from '../shared/pane'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { parseScreen, type ScreenState } from '../shared/screen'
import type { SessionOpen } from '../shared/session'
import { GHOSTTY, isLight } from '../shared/theme'

function sessionDir(): string {
  return join(app.getPath('userData'), 's')
}

function coreBin(override: string | undefined, name: string): string {
  return (
    override ??
    (app.isPackaged
      ? join(process.resourcesPath, 'bin', name)
      : join(app.getAppPath(), '../core/target/debug', name))
  )
}

function sessionBin(): string {
  return coreBin(process.env.MARU_SESSION_BIN, 'maru-session')
}

function resourceDir(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'resources', name)
}

function cliAccess(): CliAccess {
  return {
    socket: appSocketPath(sessionDir()),
    bin: coreBin(process.env.MARU_CLI_BIN, 'maru')
  }
}

const claudeStatus = createClaudeStatus({
  notify: (session, state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('claude:status', session, state)
    }
  }
})

const monitor = createMonitor({
  shellPidOf: async (id) => (await readRecord(sessionDir(), id))?.shell_pid ?? null
})

const inbox = createInbox({ isLive: (id) => sessionLive(sessionDir(), id), emit: monitor.emit })

// 창은 하나다.
function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

const sessionWorkspaces = createSessionWorkspaces()

const panes = createPanes((channel, id, arg) => {
  const win = mainWindow()
  if (!win || win.isDestroyed()) return false
  win.webContents.send(channel, id, arg)
  return true
})

const devServer = Boolean(process.env.ELECTRON_RENDERER_URL)
// `screen:state` 는 자주 오고 재시작 때만 읽으므로, `parseScreen` 은 읽을 때 부른다.
let lastScreen: unknown = null
let keepSessions = false
let restarting = false

function restartCheck(): Promise<RestartCheck> {
  const screen = parseScreen(lastScreen)
  return checkRestart({ devServer, screen, bin: sessionBin(), dir: sessionDir() })
}

/** 저장하지 못하면 던진다 — 다시 뜬 앱은 화면 없이 세션을 모두 끄기 때문이다. */
async function saveScreen(): Promise<void> {
  const screen = parseScreen(lastScreen)
  if (!screen) throw new Error('the window has not reported its layout yet')
  await writeScreen(restartFile(app.getPath('userData')), screen)
}

function relaunch(): void {
  if (restarting) return
  restarting = true
  keepSessions = true
  app.relaunch()
  app.quit()
}

async function restartFromMenu(): Promise<void> {
  const check = await restartCheck()
  if (!check.ok && check.reason !== 'incompatible') return
  if (!check.ok) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: 'Restart and end all terminals?',
      detail: incompatibleDetail(check),
      buttons: ['Restart', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    if (response !== 0) return
  }
  try {
    await saveScreen()
  } catch (err) {
    dialog.showErrorBox('Cannot restart', err instanceof Error ? err.message : String(err))
    return
  }
  relaunch()
}

function incompatibleDetail(check: { sessions: number; protocol: number | null }): string {
  const installed =
    check.protocol === null
      ? 'cannot tell its session protocol'
      : `uses session protocol ${check.protocol}`
  return `${check.sessions} terminal(s) will end: the installed app ${installed} and this app uses ${PROTOCOL_VERSION}.`
}

const restartHandlers: Handlers = {
  'app.restart': async ({ kill_sessions: kill }) => {
    if (kill !== undefined && typeof kill !== 'boolean') {
      throw new InvalidParams('params.kill_sessions must be a boolean')
    }
    const check = await restartCheck()
    if (!check.ok && check.reason !== 'incompatible') {
      throw new CliError(
        -32001,
        'restart_unavailable',
        check.reason === 'dev_server'
          ? 'an app started by the dev server cannot restart itself'
          : 'the window has not reported its layout yet'
      )
    }
    if (!check.ok && !kill) {
      throw new CliError(
        -32001,
        'sessions_would_end',
        `${incompatibleDetail(check)} Pass --kill-sessions to restart anyway.`,
        { sessions: check.sessions }
      )
    }
    await saveScreen()
    return new AfterReply(null, relaunch)
  }
}

const cliHandlers: Handlers = {
  ping: (_params, session) => ({ session }),
  'canvas.put': canvasPut(mainWindow),
  ...claudeStatus.handlers,
  ...monitor.handlers,
  ...inbox,
  ...panes.handlers,
  ...restartHandlers
}

const unobtrusive = Boolean(process.env.MARU_UNOBTRUSIVE)

function openExternal(url: string): void {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
}

function createWindow(): void {
  const stateFile = join(app.getPath('userData'), 'window-state.json')
  const state = readWindowState(stateFile)
  const displays = screen.getAllDisplays().map((d) => d.bounds)
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    ...windowBounds(state, displays),
    show: !unobtrusive,
    focusable: !unobtrusive,
    backgroundColor: GHOSTTY.background,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // DevTools 에서는 메뉴와 상관없이 창을 새로 고칠 수 있는데, 새로 고치면 workspace 목록을 잃는다.
      devTools: !app.isPackaged
    }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isDevReload(url, win.webContents.getURL(), process.env.ELECTRON_RENDERER_URL)) return
    event.preventDefault()
    openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  if (unobtrusive) {
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
    win.showInactive()
  }
  restoreWindowState(win, state)
  saveWindowStateOnClose(win, stateFile)
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let host: UtilityProcess | null = null

/**
 * Dock 에서 띄운 앱은 LANG 을 받지 못해, 로케일을 스스로 정하지 않는 셸(bash 등)이 US-ASCII 로 떠
 * 한글 입력을 버린다. 지역 설정으로 채운다.
 */
function hostEnv(): NodeJS.ProcessEnv {
  const env = process.env
  if (process.platform !== 'darwin' || env.LANG || env.LC_ALL || env.LC_CTYPE) return env
  return { ...env, LANG: utf8Locale(app.getSystemLocale()) }
}

/**
 * 세션 바이트는 이 프로세스와 renderer 사이를 오가고 main 을 지나지 않는다 — 출력이 쏟아질 때
 * main 이 막혀 창 조작까지 멈추지 않게.
 */
function sessionHost(): UtilityProcess {
  if (!host) {
    const proc = utilityProcess.fork(join(__dirname, 'session-host.js'), [], {
      serviceName: 'maru-session-host',
      env: hostEnv()
    })
    proc.once('exit', () => {
      host = null
      // 포트의 반대쪽이 사라져도 renderer 의 MessagePort 는 알려 주지 않는다.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('session:lost')
      }
    })
    host = proc
  }
  return host
}

// 두 번째 실행이 같은 세션 디렉토리에서 세션을 하나 더 띄우지 않게.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (unobtrusive) return
    const win = mainWindow()
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  app.whenReady().then(start)
}

function start(): void {
  if (unobtrusive) app.dock?.hide()
  // 창 틀이 시스템 설정 대신 터미널 배경을 따라야, 어두운 터미널 위에 밝은 타이틀바가 뜨지 않는다.
  nativeTheme.themeSource = isLight(GHOSTTY) ? 'light' : 'dark'
  const restored = takeScreen(restartFile(app.getPath('userData')))
  // 재시작으로 뜨지 않았으면 앱이 비정상으로 끝나 남은 세션이다. 새 세션은 그 정리가 끝난 뒤에 띄운다.
  const leftovers = restored.then((screen) =>
    killSessions(sessionDir(), undefined, screenSessions(screen))
  )
  let toRestore: Promise<ScreenState | null> | null = restored
  ipcMain.handle('screen:restore', () => {
    const screen = toRestore
    toRestore = null
    return screen
  })
  ipcMain.on('screen:state', (_event, screen: unknown) => (lastScreen = screen))
  ipcMain.on('app:restart', () => void restartFromMenu())
  const cli = cliAccess()
  // 터미널은 CLI 없이도 쓸 수 있어야 한다. env 는 그대로 넣어 CLI 가 앱에 닿지 않는다고 말하게 한다.
  const cliServer = listenCli(cli.socket, cliHandlers).catch((err) => {
    console.error(`maru: cannot listen on ${cli.socket}:`, err)
    return null
  })
  // 셸이 뜨자마자 `maru` 를 불러도 닿게.
  const ready = Promise.all([leftovers, cliServer])
  ipcMain.on('pane:reply', (_event, id: number, reply: PaneReply) => panes.reply(id, reply))
  ipcMain.handle('claude:statuses', () => claudeStatus.snapshot())
  ipcMain.handle('git:head', (_event, cwd: unknown) =>
    typeof cwd === 'string' ? gitHead(cwd) : null
  )
  ipcMain.on('window:path', (event, path: unknown) => {
    if (process.platform === 'darwin' && typeof path === 'string')
      BrowserWindow.fromWebContents(event.sender)?.setRepresentedFilename(path)
  })
  const setup = { cli, zdotdir: resourceDir('zsh'), claudePlugin: resourceDir('claude-plugin') }
  // open 과 같은 `ready.then` 으로 보내야 host 가 그 open 을 먼저 받는다.
  const sendKill = (key: string): void => {
    sessionWorkspaces.close(key)
    const req: KillRequest = { type: 'kill', key, dir: sessionDir() }
    void ready.then(() => sessionHost().postMessage(req))
  }
  // docs/architecture.md 의 "문서가 바뀌면 이전 문서의 세션을 끈다".
  const opened = new Map<number, Set<string>>()
  app.on('web-contents-created', (_event, contents) => {
    let leaving = new Set<string>()
    // 이동이 시작된 뒤 새 문서가 연 세션을 끄지 않게, 시작할 때 있던 세션만 끈다.
    contents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) leaving = new Set(opened.get(contents.id))
    })
    contents.on('did-navigate', () => {
      for (const key of leaving) {
        opened.get(contents.id)?.delete(key)
        sendKill(key)
      }
      leaving = new Set()
    })
    contents.once('destroyed', () => opened.delete(contents.id))
  })
  ipcMain.on('session:open', (event, key: string, open: SessionOpen) => {
    const { id, workspace, cwd, command, attach } = open
    const keys = opened.get(event.sender.id) ?? new Set<string>()
    opened.set(event.sender.id, keys.add(key))
    sessionWorkspaces.open(key, id, workspace)
    const { port1, port2 } = new MessageChannelMain()
    const req: OpenRequest = {
      type: 'open',
      key,
      id,
      cwd,
      command,
      attach,
      dir: sessionDir(),
      bin: sessionBin(),
      setup
    }
    void ready.then(() => sessionHost().postMessage(req, [port1]))
    // host 에 넘기는 것(위 ready.then)보다 먼저 renderer 에 가야 한다 — renderer 는 포트보다 먼저 온
    // session:lost 를 이 open 이전 host 의 것으로 보고 버린다(renderer/src/session/connection.ts).
    event.sender.postMessage('session:port', key, [port2])
  })

  ipcMain.on('session:kill', (event, key: string) => {
    opened.get(event.sender.id)?.delete(key)
    sendKill(key)
  })

  app.on('window-all-closed', () => app.quit())
  // 세션은 앱과 따로 떠 있는 프로세스라 앱이 끝나도 남는다.
  let sessionsKilled = false
  app.on('will-quit', (event) => {
    if (sessionsKilled) return
    event.preventDefault()
    claudeStatus.close()
    void Promise.all([
      keepSessions || killSessions(sessionDir()),
      cliServer.then((server) => server?.close())
    ]).finally(() => {
      sessionsKilled = true
      app.quit()
    })
  })

  // 재시작은 renderer 를 거치지 않는다. renderer 가 멈췄을 때도 메뉴로 재시작할 수 있어야 하기 때문이다.
  installCommandMenu(
    (id) =>
      id === 'restart' ? void restartFromMenu() : mainWindow()?.webContents.send('command:run', id),
    { canRestart: !devServer }
  )
  createWindow()
}
