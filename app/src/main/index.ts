import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
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
import { canvasPut, putCanvas } from './canvas'
import { createClaudeStatus } from './claude-status'
import { AfterReply, CliError, listenCli, optionalBoolean, type Handlers } from './cli-server'
import { configDir, configFile, readConfigFile, watchConfig } from './config-file'
import { gitHead } from './git'
import { createInbox } from './inbox'
import { installCommandMenu } from './menu'
import { createMonitor } from './monitor'
import { isDevReload } from './navigation'
import { createPanes } from './pane'
import { createJobs, JOB_REPLY_MS } from './job'
import { openLink } from './links'
import {
  checkRestart,
  restartFile,
  screenSessions,
  takeRestart,
  writeRestart,
  type RestartCheck
} from './restart'
import {
  appSocketPath,
  captureSession,
  foregroundCwd,
  killSession,
  killSessions,
  QUIT_TIMEOUT_MS,
  readRecord,
  sameDirAs,
  sessionLive,
  spawnSession,
  startDir,
  utf8Locale,
  waitSessionExit,
  writeSessionInput,
  type CliAccess
} from './session'
import type { KillRequest, OpenRequest, QuitRequest } from './session-host'
import { createSessionCells } from './session-cells'
import {
  readWindowExtras,
  readWindowState,
  restoreWindowState,
  saveWindowStateOnClose,
  windowBounds
} from './window-state'
import type { PaneReply } from '../shared/pane'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { parseScreen, parseViewPrefs, type ScreenState, type ViewPrefs } from '../shared/screen'
import { newSessionId, type SessionOpen } from '../shared/session'
import { GHOSTTY, isLight, parseWindowTheme, type WindowTheme } from '../shared/theme'

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

function sendToWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

const claudeStatus = createClaudeStatus({
  notify: (session, state) => sendToWindows('claude:status', session, state),
  moved: (session) => sendToWindows('claude:moved', session)
})

// 재시작한 앱의 monitor 는 표를 되살리기 전에도 붙으므로, 보류한 알림은 되살린 뒤에 보낸다.
let jobs: ReturnType<typeof createJobs> | null = null
let jobsRestored: Promise<void> = Promise.resolve()
let claudeRestored: Promise<void> = Promise.resolve()

const monitor = createMonitor({
  shellPidOf: async (id) => (await readRecord(sessionDir(), id))?.shell_pid ?? null,
  onSubscribe: (session) => void jobsRestored.then(() => jobs?.subscribed(session))
})

const inbox = createInbox({ isLive: (id) => sessionLive(sessionDir(), id), emit: monitor.emit })

// 창은 하나다.
function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

const sessionCells = createSessionCells()

const panes = createPanes(
  (channel, id, arg) => {
    const win = mainWindow()
    if (!win || win.isDestroyed()) return false
    win.webContents.send(channel, id, arg)
    return true
  },
  (session) => jobs?.cellOf(session)
)

const devServer = Boolean(process.env.ELECTRON_RENDERER_URL)
// `screen:state` 는 자주 오고 재시작·창 닫기·문서 로드 때만 읽으므로, 받은 값을 그대로 두었다가 읽을 때 `parseScreen`·`parseViewPrefs` 로 검사한다.
let lastScreen: unknown = null
let keepSessions = false
let restarting = false

function windowStateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function viewPrefs(): ViewPrefs {
  return { ...readWindowExtras(windowStateFile()), ...parseViewPrefs(lastScreen) }
}

const DEFAULT_WINDOW_THEME: WindowTheme = {
  background: GHOSTTY.background,
  mode: isLight(GHOSTTY) ? 'light' : 'dark'
}
let theme: WindowTheme | null = null

function applyTheme(next: WindowTheme): void {
  if (theme && next.background === theme.background && next.mode === theme.mode) return
  theme = next
  // 창 틀이 시스템 설정 대신 터미널 배경을 따라야, 어두운 터미널 위에 밝은 타이틀바가 뜨지 않는다.
  nativeTheme.themeSource = next.mode
  const win = mainWindow()
  if (win && !win.isDestroyed()) win.setBackgroundColor(next.background)
}

function restartCheck(): Promise<RestartCheck> {
  const screen = parseScreen(lastScreen)
  return checkRestart({ devServer, screen, bin: sessionBin(), dir: sessionDir() })
}

/** 저장하지 못하면 던진다 — 다시 뜬 앱은 화면 없이 세션을 모두 끄기 때문이다. */
async function saveScreen(): Promise<void> {
  const screen = parseScreen(lastScreen)
  if (!screen) throw new Error('the window has not reported its layout yet')
  try {
    await writeRestart(restartFile(app.getPath('userData')), {
      screen,
      jobs: jobs?.save() ?? null,
      claude: claudeStatus.save()
    })
  } catch (err) {
    jobs?.resume()
    throw err
  }
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
  'app.restart': async (params) => {
    const kill = optionalBoolean(params.kill_sessions, 'kill_sessions')
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
  const stateFile = windowStateFile()
  const state = readWindowState(stateFile)
  const displays = screen.getAllDisplays().map((d) => d.bounds)
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    ...windowBounds(state, displays),
    show: !unobtrusive,
    focusable: !unobtrusive,
    backgroundColor: (theme ?? DEFAULT_WINDOW_THEME).background,
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
  // `will-navigate` 가 navigation 을 막으면 문서가 그대로이므로, 새 문서로 바뀐 뒤(`did-navigate`)에 `unready` 를 부른다.
  win.webContents.on('did-navigate', panes.unready)
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
  saveWindowStateOnClose(win, stateFile, () => ({ ...viewPrefs(), ...(theme && { theme }) }))
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
      sendToWindows('session:lost')
    })
    host = proc
  }
  return host
}

// 두 번째 실행이 같은 세션 디렉토리에서 세션을 하나 더 띄우지 않게 끝낸다.
if (!app.requestSingleInstanceLock()) {
  console.error(
    `maru: another instance is using ${app.getPath('userData')}; quitting. Start with --user-data-dir=<dir> (pnpm dev -- --user-data-dir=<dir>) to run alongside it.`
  )
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
  applyTheme(readWindowExtras(windowStateFile()).theme ?? DEFAULT_WINDOW_THEME)
  ipcMain.on('theme:apply', (_event, t: unknown) => {
    const parsed = parseWindowTheme(t)
    if (parsed) applyTheme(parsed)
  })
  const userData = app.getPath('userData')
  const restored = takeRestart(restartFile(userData))
  // 재시작으로 뜨지 않았으면 앱이 비정상으로 끝나 남은 세션이다. 새 세션은 그 정리가 끝난 뒤에 띄운다.
  const leftovers = restored.then((r) => {
    const keep = screenSessions(r?.screen ?? null)
    for (const j of r?.jobs?.jobs ?? []) keep.add(j.session)
    return killSessions(sessionDir(), undefined, keep)
  })
  // `leftovers` 가 끈 세션의 Claude 상태는 되살리지 않는다. 프로토콜이 달라 꺼진 세션의 claude 는 아직 상태 파일을 지우지 않았을 수 있어, 되살린 뒤 첫 폴링으로는 끝난 것을 알지 못하기 때문이다.
  claudeRestored = Promise.all([restored, leftovers]).then(async ([r]) => {
    if (!r?.claude) return
    const saved = Object.entries(r.claude.sessions)
    const live = await Promise.all(saved.map(([id]) => sessionLive(sessionDir(), id)))
    const sessions = Object.fromEntries(saved.filter((_, i) => live[i]))
    await claudeStatus.restore({ ...r.claude, sessions })
  })
  let toRestore: Promise<ScreenState | null> | null = restored.then((r) => r?.screen ?? null)
  ipcMain.handle('screen:restore', () => {
    const screen = toRestore
    toRestore = null
    return screen
  })
  ipcMain.on('screen:prefs', (event) => (event.returnValue = viewPrefs()))
  const configPath = configFile()
  let config = readConfigFile(configPath)
  ipcMain.on('config:read', (event) => (event.returnValue = config))
  // 내용이 같아도 저장할 때마다 보낸다. 사용자가 닫은 토스트도 같은 내용으로 다시 저장하면 다시 띄워야 하기 때문이다.
  const stopConfig = watchConfig(configDir(), () => {
    config = readConfigFile(configPath)
    const win = mainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('config:changed', config)
  })
  ipcMain.on('screen:state', (_event, screen: unknown) => (lastScreen = screen))
  ipcMain.on('app:restart', () => void restartFromMenu())
  const cli = cliAccess()
  const setup = { cli, zdotdir: resourceDir('zsh'), claudePlugin: resourceDir('claude-plugin') }
  // pane 의 셸과 같은 환경(LANG 보정 포함)으로 job 을 띄운다.
  const jobEnv = hostEnv()
  // job 은 host 를 거치지 않으므로, 앱을 끌 때 main 이 띄우던 job 을 직접 기다린다.
  const jobSpawns = new Set<Promise<void>>()
  let quitting = false
  const jobTable = createJobs({
    newId: newSessionId,
    cellOf: sessionCells.cellOf,
    spawn: async (id, cwd, command) => {
      await ready
      if (quitting) throw new Error('AI Maru is quitting')
      const spawned = startDir(cwd).then((dir) =>
        spawnSession(sessionBin(), sessionDir(), setup, id, dir, command, {
          keep: true,
          env: jobEnv
        })
      )
      const settled = spawned.then(
        () => {},
        () => {}
      )
      jobSpawns.add(settled)
      void settled.then(() => jobSpawns.delete(settled))
      await spawned
    },
    waitExit: (id) => waitSessionExit(sessionDir(), id),
    capture: (id) => captureSession(sessionDir(), id, JOB_REPLY_MS),
    input: (id, text) => writeSessionInput(sessionDir(), id, text, JOB_REPLY_MS),
    kill: (id) => killSession(sessionDir(), id),
    emit: monitor.emit
  })
  jobs = jobTable
  // `leftovers` 의 `killSessions` 는 job 세션을 끄지 않으므로 그것을 기다리지 않고 되살린다.
  jobsRestored = restored.then((r) => void (r?.jobs && jobTable.restore(r.jobs)))
  // 터미널은 CLI 없이도 쓸 수 있어야 한다. env 는 그대로 넣어 CLI 가 앱에 닿지 않는다고 말하게 한다.
  const cliServer = listenCli(cli.socket, { ...cliHandlers, ...jobTable.handlers }).catch((err) => {
    console.error(`maru: cannot listen on ${cli.socket}:`, err)
    return null
  })
  // 셸이 뜨자마자 `maru` 를 불러도 닿게.
  const ready = Promise.all([leftovers, cliServer])
  ipcMain.on('pane:reply', (_event, id: number, reply: PaneReply) => panes.reply(id, reply))
  ipcMain.on('pane:ready', () => panes.ready())
  ipcMain.handle('claude:statuses', () => claudeRestored.then(claudeStatus.snapshot))
  ipcMain.handle('git:head', (_event, cwd: unknown) =>
    typeof cwd === 'string' ? gitHead(cwd) : null
  )
  const readForeground = (id: string): Promise<string | null> => foregroundCwd(sessionDir(), id)
  ipcMain.handle('session:foreground', async (_event, session: unknown, cwd: unknown) => {
    if (typeof session !== 'string') return null
    const dir = await readForeground(session)
    return dir !== null && typeof cwd === 'string' ? sameDirAs(dir, cwd) : dir
  })
  ipcMain.handle('link:open', (_event, text: unknown, session: unknown) => {
    if (typeof text !== 'string' || typeof session !== 'string') {
      return { ok: false, reason: 'not a link' }
    }
    return openLink(text, session, {
      openExternal: (url) => shell.openExternal(url),
      openPath: (path) => shell.openPath(path),
      putCanvas: (doc) => putCanvas(mainWindow, doc),
      foregroundCwd: readForeground
    })
  })
  ipcMain.on('window:path', (event, path: unknown) => {
    if (process.platform === 'darwin' && typeof path === 'string')
      BrowserWindow.fromWebContents(event.sender)?.setRepresentedFilename(path)
  })
  // open 과 같은 `ready.then` 으로 보내야 host 가 그 open 을 먼저 받는다.
  const sendKill = (key: string): void => {
    const closed = sessionCells.close(key)
    if (!closed) return
    // cell 의 마지막 pane 을 지우면 renderer 가 cell 도 지운다(docs/architecture.md).
    if (closed.closed) void jobTable.closeCell(closed.closed)
    const req: KillRequest = { type: 'kill', id: closed.session, dir: sessionDir() }
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
    const { id, cell, cwd, command, attach } = open
    const keys = opened.get(event.sender.id) ?? new Set<string>()
    opened.set(event.sender.id, keys.add(key))
    sessionCells.open(key, id, cell)
    const { port1, port2 } = new MessageChannelMain()
    const req: OpenRequest = {
      type: 'open',
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
  // open 과 같은 `ready.then` 으로 보내야 host 가 그 앞의 open 을 먼저 받는다.
  const stopHost = (): Promise<void> =>
    ready.then(() => {
      const proc = host
      if (!proc) return
      return new Promise<void>((resolve) => {
        // 멈춘 host 를 기다리느라 앱이 꺼지지 않게 상한을 둔다. 그때 띄우던 세션 가운데 소켓을 연 세션은 다음 실행의 정리가 끈다.
        const timer = setTimeout(() => {
          // 멈춘 프로세스는 SIGTERM 을 처리하지 못한다. host 가 방금 끝나 `exit` 이 아직 오지 않았으면 kill 이 실패한다.
          try {
            if (proc.pid) process.kill(proc.pid, 'SIGKILL')
          } catch {
            // 이미 끝났다.
          }
          resolve()
        }, QUIT_TIMEOUT_MS)
        proc.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        const req: QuitRequest = { type: 'quit' }
        proc.postMessage(req)
      })
    })
  // 세션은 앱과 따로 떠 있는 프로세스라 앱이 끝나도 남는다.
  let sessionsKilled = false
  app.on('will-quit', (event) => {
    if (sessionsKilled) return
    event.preventDefault()
    claudeStatus.close()
    stopConfig()
    quitting = true
    void Promise.all([
      keepSessions ||
        Promise.all([
          stopHost(),
          // job 의 시작 폴더 확인(`startDir`)에는 시간 제한이 없다. 응답하지 않는 마운트에 있는 job 때문에 앱이 꺼지지 않을 수 있으므로, host 와 같은 상한까지만 기다린다.
          Promise.race([Promise.all(jobSpawns), sleep(QUIT_TIMEOUT_MS)])
        ]).then(() => killSessions(sessionDir())),
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
