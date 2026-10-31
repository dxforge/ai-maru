import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  Notification,
  nativeTheme,
  powerMonitor,
  screen,
  shell,
  utilityProcess,
  type UtilityProcess
} from 'electron'
import { canvasPut, putCanvas } from './canvas'
import {
  closePaneDialog,
  createQuitPermission,
  QUIT_OUTCOMES,
  quitDialog,
  runningDialog,
  runningPanes,
  runningProgram,
  stopJobDialog,
  type Dialog,
  type ProgramDeps
} from './close-confirm'
import { AfterReply, CliError, listenCli, optionalBoolean, type Handlers } from './cli-server'
import { configDir, configFile, readConfigFile, watchConfig } from './config-file'
import { createDesktopNotifications, type DesktopNotice } from './desktop-notification'
import { gitHead } from './git'
import { createInbox } from './inbox'
import { mcpHandlers } from './mcp'
import { installCommandMenu } from './menu'
import { createMonitor } from './monitor'
import { isDevReload } from './navigation'
import { createPanes } from './pane'
import { createJobs, JOB_REPLY_MS } from './job'
import { createLauncherStore, listDirs } from './launcher'
import { longestExistingPaths, openLink, type LinkOpener } from './links'
import { createPortWatch, readPorts } from './ports'
import { checkRestart, restartDialog, restartRefusal, type RestartCheck } from './restart'
import {
  appSocketPath,
  capturePty,
  foreground,
  foregroundCwd,
  killPty,
  killPtys,
  livePtys,
  QUIT_TIMEOUT_MS,
  readRecord,
  runDir,
  ptyLive,
  spawnPty,
  startDir,
  subscribeState,
  utf8Locale,
  waitPtyExit,
  writePtyInput,
  type CliAccess
} from './pty'
import type { HostEvent, KillRequest, OpenRequest, QuitRequest } from './pty-host'
import { createPtyCells } from './pty-cells'
import { createPtyStates } from './pty-state'
import { createSeen } from './seen'
import {
  createStateStore,
  readState,
  removeOldStateFiles,
  restorePlan,
  sessionPtys,
  stateFile,
  type Outcome,
  type StateStore
} from './state'
import {
  restoreWindowState,
  trackWindowState,
  windowBounds,
  type WindowState
} from './window-state'
import { jobName, type JobView } from '../shared/job'
import { isPathCandidates } from '../shared/link'
import { paneRows } from '../shared/pane-list'
import type { CloseAnswer, PaneReply } from '../shared/pane'
import {
  parseScreen,
  screenPanes,
  type LayoutPart,
  type Restore,
  type ViewPrefs
} from '../shared/screen'
import { isPtyId, newPtyId, type PtyOpen } from '../shared/pty'
import { GHOSTTY, isLight, parseWindowTheme, type WindowTheme } from '../shared/theme'

const runFile = promisify(execFile)

function ptyDir(): string {
  return runDir(app.getPath('userData'))
}

function coreBin(override: string | undefined, name: string): string {
  return (
    override ??
    (app.isPackaged
      ? join(process.resourcesPath, 'bin', name)
      : join(app.getAppPath(), '../core/target/debug', name))
  )
}

function ptyBin(): string {
  return coreBin(process.env.MARU_PTY_BIN, 'maru-pty')
}

function resourceDir(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'resources', name)
}

function cliAccess(): CliAccess {
  return {
    socket: appSocketPath(ptyDir()),
    bin: coreBin(process.env.MARU_CLI_BIN, 'maru')
  }
}

function sendToWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

// 재시작한 앱의 monitor 는 표를 되살리기 전에도 붙으므로, 보류한 알림은 되살린 뒤에 보낸다.
let jobs: ReturnType<typeof createJobs> | null = null
let jobsRestored: Promise<void> = Promise.resolve()

const shellPidOf = async (id: string): Promise<number | null> =>
  (await readRecord(ptyDir(), id))?.shell_pid ?? null

const monitor = createMonitor({
  shellPidOf,
  onSubscribe: (pty) => void jobsRestored.then(() => jobs?.subscribed(pty))
})

const inbox = createInbox({ isLive: (id) => ptyLive(ptyDir(), id), emit: monitor.emit })

// 창은 하나다.
function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

const ptyCells = createPtyCells()

function ptyLabel(pty: string): string | undefined {
  const screen = parseScreen(lastScreen)
  const row =
    screen &&
    paneRows(screen.workspaces, ptyStates.state, process.env.SHELL, process.env.HOME).find(
      (r) => r.pty === pty
    )
  if (row) return row.title
  const job = jobs?.get(pty)
  return job && jobName(job)
}

function bringToFront(win: BrowserWindow | undefined): void {
  if (win?.isMinimized()) win.restore()
  win?.focus()
}

// macOS 에서는 띄운 알림 객체가 GC 되면 눌러도 click 이 오지 않으므로 객체를 쥐고 있는다. macOS 는 알림 센터로 넘어간 알림의
// close 를 알리지 않을 수 있어서 pty 마다 마지막 알림만 쥔다. 그래서 같은 pty 의 앞 알림을 누르면 아무 일도 없고, 뒤 알림을 누르면
// 그 pane 을 연다.
const shownNotifications = new Map<string, Notification>()

function showNotification(pty: string, notice: DesktopNotice, clicked: () => void): void {
  // e2e 의 창(`unobtrusive`)은 OS 포커스를 받지 않아, 포커스 조건만 보면 테스트가 사용자의 화면에 알림을 띄우므로 e2e 에서는
  // 띄우지 않는다.
  if (unobtrusive || !Notification.isSupported()) return
  const n = new Notification(notice)
  shownNotifications.set(pty, n)
  const drop = (): void => {
    if (shownNotifications.get(pty) === n) shownNotifications.delete(pty)
  }
  n.on('close', drop)
  n.on('failed', drop)
  n.on('click', () => {
    drop()
    clicked()
  })
  n.show()
}

const desktopNotifications = createDesktopNotifications({
  now: Date.now,
  focused: () => BrowserWindow.getFocusedWindow() !== null,
  label: ptyLabel,
  show: showNotification,
  open: (pty) => {
    const win = mainWindow()
    if (!win || win.isDestroyed()) return
    bringToFront(win)
    win.webContents.send('pane:select', pty)
  }
})

// renderer 가 `pane:viewed` 로 알린, 입력 focus 를 가진 pane 의 pty. renderer 를 다시 읽으면 renderer 가 다시 알리기 전까지 보고 있는 pty 가 없는 것으로 친다.
let viewedPty: string | null = null

// main 은 renderer 가 붙어 있든 아니든 pty 마다 상태 구독을 열어 마지막 상태를 든다(docs/architecture.md 의 "pty 상태는 main 이 구독해 든다").
const ptyStates = createPtyStates({
  subscribe: (id, on) => subscribeState(ptyDir(), id, on),
  isLive: (id) => ptyLive(ptyDir(), id),
  emit: (pty, entry) => sendToWindows('pty:state', pty, entry),
  notified: desktopNotifications,
  viewing: (pty) => pty === viewedPty,
  doneWhileViewed: (pty, records) => void seen(pty, records)
})

const seen = createSeen({
  records: ptyStates.records,
  run: async (args) => {
    const cli = cliAccess()
    await runFile(cli.bin, args, { env: { ...process.env, MARU_SOCKET: cli.socket } })
  }
})

const panes = createPanes(
  (channel, id, arg) => {
    const win = mainWindow()
    if (!win || win.isDestroyed()) return false
    win.webContents.send(channel, id, arg)
    return true
  },
  (pty) => jobs?.cellOf(pty)
)

const devServer = Boolean(process.env.ELECTRON_RENDERER_URL)
// renderer 가 보낸 마지막 화면. 자주 오고 읽는 일은 드물므로, 받은 값을 그대로 두었다가 읽을 때 `parseScreen` 으로 검사한다.
let lastScreen: unknown = null
let restarting = false
let store: StateStore | null = null
let outcome: Outcome | null = null
let savedWindow: (() => WindowState) | null = null

/**
 * 변경이 쏟아질 때(창을 끌어 옮기는 동안 `move`, 출력마다 바뀌는 제목) 한 번에 모아 쓴다. 앱이 죽으면 마지막 0.5초의
 * 변경만 잃는다.
 */
const STATE_DEBOUNCE_MS = 500

function viewPrefs(): ViewPrefs {
  const { viewMode, sidebar, folded, canvas } = store?.view() ?? {}
  return { viewMode, sidebar, folded, canvas }
}

function openPanes(): number {
  const screen = parseScreen(lastScreen)
  const layout: Pick<LayoutPart, 'workspaces'> | null = screen ?? store?.layout() ?? null
  return (layout?.workspaces ?? []).flatMap((w) => w.cells.flatMap((c) => c.panes)).length
}

const DEFAULT_WINDOW_THEME: WindowTheme = {
  background: GHOSTTY.background,
  mode: isLight(GHOSTTY) ? 'light' : 'dark'
}
let theme: WindowTheme | null = null

function applyTheme(next: WindowTheme): void {
  if (theme && next.background === theme.background && next.mode === theme.mode) return
  theme = next
  store?.setTheme(next)
  // 창 틀이 시스템 설정 대신 터미널 배경을 따라야, 어두운 터미널 위에 밝은 타이틀바가 뜨지 않는다.
  nativeTheme.themeSource = next.mode
  const win = mainWindow()
  if (win && !win.isDestroyed()) win.setBackgroundColor(next.background)
}

function versionsFile(): string {
  return process.env.MARU_STATE_VERSIONS_FILE ?? resourceDir('state-versions.json')
}

function restartCheck(): Promise<RestartCheck> {
  return checkRestart({ devServer, bin: ptyBin(), versionsFile: versionsFile(), dir: ptyDir() })
}

/** 쓰지 못하면 던진다. 다음에 뜬 앱이 고른 결과를 모르기 때문이다. */
function finishWith(o: Outcome): void {
  if (outcome) return
  try {
    if (savedWindow) store?.setWindow(savedWindow())
  } catch {
    // 창이 이미 닫혔다. 마지막으로 알린 창 상태가 남아 있다.
  }
  if (o === 'keep') jobs?.detach()
  try {
    store?.finish(o)
  } catch (err) {
    if (o === 'keep') jobs?.resume()
    throw err
  }
  outcome = o
  quitPermission.allow()
}

function quitWith(o: Outcome): void {
  try {
    finishWith(o)
  } catch (err) {
    console.error('maru: cannot save the state before quitting:', err)
    // 고른 대로 끝낸다. pty 를 남기면 다음 실행이 디스크에 남은 마지막 상태로 다시 붙을 수 있다.
    if (o === 'keep') jobs?.detach()
    outcome = o
    quitPermission.allow()
  }
}

function relaunch(): void {
  if (restarting) return
  restarting = true
  app.relaunch()
  app.quit()
}

function restartOutcome(check: RestartCheck): Outcome {
  if (check.ok) return 'keep'
  return check.reason === 'incompatible' && check.result === 'empty' ? 'end' : 'layout'
}

async function restartFromMenu(): Promise<void> {
  const check = await restartCheck()
  if (!check.ok && check.reason === 'dev_server') return
  if (!check.ok && !(await confirm(restartDialog(check)))) return
  try {
    finishWith(restartOutcome(check))
  } catch (err) {
    dialog.showErrorBox('Cannot restart', err instanceof Error ? err.message : String(err))
    return
  }
  relaunch()
}

const restartHandlers: Handlers = {
  'app.restart': async (params) => {
    const kill = optionalBoolean(params.kill_ptys, 'kill_ptys')
    const check = await restartCheck()
    if (!check.ok && check.reason === 'dev_server') {
      throw new CliError(
        -32001,
        'restart_unavailable',
        'an app started by the dev server cannot restart itself'
      )
    }
    if (!check.ok && !kill) {
      throw new CliError(-32001, 'ptys_would_end', restartRefusal(check), {
        ptys: check.ptys,
        result: check.result
      })
    }
    finishWith(restartOutcome(check))
    return new AfterReply(null, relaunch)
  }
}

const programDeps: ProgramDeps = {
  foreground: (id) => foreground(ptyDir(), id),
  shellPid: shellPidOf,
  command: (id) => ptyStates.command(id)
}

async function confirm(options: Dialog): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    ...options,
    defaultId: 1,
    cancelId: 1
  })
  return response === 0
}

let asking = false

async function checkClose(find: () => Promise<Dialog | null>): Promise<CloseAnswer> {
  if (asking) return { close: false, asked: true }
  const options = await find()
  if (options === null) return { close: true, asked: false }
  if (asking) return { close: false, asked: true }
  asking = true
  try {
    return { close: await confirm(options), asked: true }
  } finally {
    asking = false
  }
}

// 화면에 아직 없는 pane 은 명령 pane 인지 모르므로 foreground 로 가른다.
async function closePaneCheck(pty: string): Promise<Dialog | null> {
  const { panes } = screenPanes(parseScreen(lastScreen))
  const pane = panes.find((p) => p.ptyId === pty) ?? { ptyId: pty }
  const program = await runningProgram(pane, programDeps)
  return program && closePaneDialog(program.name)
}

async function closeWorkspaceCheck(workspace: string): Promise<Dialog | null> {
  const { panes, cells } = screenPanes(parseScreen(lastScreen), workspace)
  const running = {
    panes: await runningPanes(panes, programDeps),
    jobs: jobs?.running(new Set(cells)) ?? 0
  }
  return runningDialog(running, 'Close this workspace?', 'Close')
}

/**
 * `lsof` 를 한 번 돌리는 데 54ms 걸렸으므로 5초 주기의 부하는 작다. 사용자는 dev 서버가 포트를 연 뒤 5초 안에 사이드바에서
 * 그 포트를 본다.
 */
const PORT_INTERVAL_MS = 5_000

const SHUTDOWN_GRACE_MS = 60_000
const quitPermission = createQuitPermission(SHUTDOWN_GRACE_MS)
let quitCheck: Promise<void> | null = null

/**
 * 한 번 통과한 종료는 끝까지 묻지 않는다. `will-quit` 이 pty 를 끈 뒤 부르는 `app.quit()` 도 `before-quit` 를 거친다.
 * 묻지 않고 끝나는 종료(OS 종료, 시그널)는 pty 가 OS 와 함께 끝나거나 이 앱이 끄므로 레이아웃만 남긴다.
 */
function mayQuit(): boolean {
  if (!quitPermission.allowed() && outcome !== 'keep') return false
  quitPermission.allow()
  if (!outcome) quitWith('layout')
  return true
}

/** 창이 하나라 창을 닫는 것은 앱을 끝내는 것이다. 그래서 창 닫기도 ⌘Q 와 같이 확인을 받은 뒤 앱을 끝낸다. */
function confirmQuit(): void {
  if (quitCheck) return
  quitCheck = (async () => {
    if (!quitPermission.allowed()) {
      const open = openPanes()
      if (open === 0) {
        quitWith('end')
      } else {
        const { panes } = screenPanes(parseScreen(lastScreen))
        const running = {
          panes: await runningPanes(panes, programDeps),
          jobs: jobs?.running() ?? 0
        }
        const { response } = await dialog.showMessageBox({
          type: 'question',
          ...quitDialog({ open, ...running }),
          defaultId: 0,
          cancelId: QUIT_OUTCOMES.length
        })
        const chosen = QUIT_OUTCOMES[response]
        if (!chosen) return
        quitWith(chosen)
      }
    }
    quitPermission.allow()
    app.quit()
  })().finally(() => (quitCheck = null))
}

const putDoc = canvasPut(mainWindow)

const cliHandlers: Handlers = {
  ping: (_params, pty) => ({ pty }),
  'pane.list': () => {
    const screen = parseScreen(lastScreen)
    if (!screen) throw new Error('the window has not reported its layout yet')
    return {
      panes: paneRows(screen.workspaces, ptyStates.state, process.env.SHELL, process.env.HOME)
    }
  },
  'canvas.put': putDoc,
  ...mcpHandlers({ put: putDoc, version: app.getVersion() }),
  ...monitor.handlers,
  ...inbox,
  ...panes.handlers,
  ...restartHandlers
}

const unobtrusive = Boolean(process.env.MARU_UNOBTRUSIVE)

function openExternal(url: string): void {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
}

function createWindow(state: WindowState | null): void {
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
  win.webContents.on('did-navigate', () => {
    panes.unready()
    viewedPty = null
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
  win.on('close', (event) => {
    if (mayQuit()) return
    event.preventDefault()
    confirmQuit()
  })
  win.on('closed', () => void (viewedPty = null))
  restoreWindowState(win, state)
  savedWindow = trackWindowState(win, (s) => store?.setWindow(s))
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
 * pty 바이트는 이 프로세스와 renderer 사이를 오가고 main 을 지나지 않는다 — 출력이 쏟아질 때
 * main 이 막혀 창 조작까지 멈추지 않게.
 */
function ptyHost(): UtilityProcess {
  if (!host) {
    const proc = utilityProcess.fork(join(__dirname, 'pty-host.js'), [], {
      serviceName: 'maru-pty-host',
      env: hostEnv()
    })
    proc.on('message', (msg: HostEvent) => {
      if (msg?.type === 'live' && isPtyId(msg.id)) ptyStates.watch(msg.id)
    })
    proc.once('exit', () => {
      host = null
      // 포트의 반대쪽이 사라져도 renderer 의 MessagePort 는 알려 주지 않는다.
      sendToWindows('pty:lost')
    })
    host = proc
  }
  return host
}

// 두 번째 실행이 같은 pty 디렉토리에서 pty 를 하나 더 띄우지 않게 끝낸다.
if (!app.requestSingleInstanceLock()) {
  console.error(
    `maru: another instance is using ${app.getPath('userData')}; quitting. Start with --user-data-dir=<dir> (pnpm dev -- --user-data-dir=<dir>) to run alongside it.`
  )
  app.quit()
} else {
  app.on('second-instance', () => {
    if (unobtrusive) return
    bringToFront(mainWindow())
  })
  app.whenReady().then(start)
}

function start(): void {
  if (unobtrusive) app.dock?.hide()
  const userData = app.getPath('userData')
  const read = readState(stateFile(userData))
  removeOldStateFiles(userData)
  const layout = read.layout.kind === 'ok' ? read.layout.value : null
  const sessions = read.sessions.kind === 'ok' ? read.sessions.value : null
  store = createStateStore({
    path: stateFile(userData),
    debounceMs: STATE_DEBOUNCE_MS,
    initial: { layout, sessions, view: read.view }
  })
  applyTheme(read.view.theme ?? DEFAULT_WINDOW_THEME)
  ipcMain.on('theme:apply', (_event, t: unknown) => {
    const parsed = parseWindowTheme(t)
    if (parsed) applyTheme(parsed)
  })
  const plan = (async () => {
    const live = new Set(await livePtys(ptyDir()))
    const alive = (sessions ? sessionPtys(sessions) : []).filter((pty) => live.has(pty))
    const records = await Promise.all(alive.map((pty) => readRecord(ptyDir(), pty)))
    const protocols = new Map(alive.map((pty, i) => [pty, records[i]?.protocol_version ?? null]))
    const p = restorePlan(read, (pty) => (protocols.has(pty) ? protocols.get(pty) : undefined))
    if (p.mode !== 'full') store?.discard(p.mode === 'empty' ? 'end' : 'layout')
    return p
  })()
  // `killPtys` 는 `keep` 에 없는 pty 를 모두 끄므로, 새 pty 는 이 정리가 끝난 뒤에 띄운다.
  const leftovers = plan.then(async (p) => {
    const keep = new Set(p.mode === 'full' && sessions ? sessionPtys(sessions) : [])
    await killPtys(ptyDir(), undefined, keep)
    for (const id of keep) ptyStates.watch(id)
  })
  let toRestore: Promise<Restore> | null = plan.then((p) => ({
    layout: p.mode === 'empty' ? null : layout,
    ptys:
      p.mode === 'full' && sessions
        ? Object.fromEntries(sessions.ptys.map(({ pane, pty }) => [pane, pty]))
        : null,
    notice: p.notice
  }))
  ipcMain.handle('screen:restore', () => {
    const r = toRestore
    toRestore = null
    return r
  })
  ipcMain.on('screen:prefs', (event) => (event.returnValue = viewPrefs()))
  const launcher = createLauncherStore(join(userData, 'launcher.json'))
  ipcMain.handle('launcher:read', () => launcher.read())
  ipcMain.handle('launcher:launched', (_event, dir: unknown, command: unknown) =>
    typeof dir === 'string' && typeof command === 'string'
      ? launcher.launched(dir, command)
      : { ok: false, reason: 'not a directory path' }
  )
  ipcMain.handle('launcher:forget', (_event, dir: unknown) =>
    typeof dir === 'string' ? launcher.forget(dir) : launcher.read()
  )
  ipcMain.handle('launcher:dirs', (_event, dir: unknown) =>
    typeof dir === 'string' ? listDirs(dir) : []
  )
  const configPath = configFile()
  let config = readConfigFile(configPath)
  ipcMain.on('config:read', (event) => (event.returnValue = config))
  // 내용이 같아도 저장할 때마다 보낸다. 사용자가 닫은 토스트도 같은 내용으로 다시 저장하면 다시 띄워야 하기 때문이다.
  const stopConfig = watchConfig(configDir(), () => {
    config = readConfigFile(configPath)
    const win = mainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('config:changed', config)
  })
  ipcMain.on('screen:state', (_event, screen: unknown) => {
    lastScreen = screen
    store?.setScreen(screen)
  })
  const refused: CloseAnswer = { close: false, asked: false }
  ipcMain.handle('pane:confirm-close', (_event, pty: unknown) =>
    isPtyId(pty) ? checkClose(() => closePaneCheck(pty)) : refused
  )
  ipcMain.handle('workspace:confirm-close', (_event, workspace: unknown) =>
    typeof workspace === 'string' ? checkClose(() => closeWorkspaceCheck(workspace)) : refused
  )
  powerMonitor.on('shutdown', () => quitPermission.shutdown())
  // 시그널을 보낸 쪽(`kill`, 터미널의 Ctrl-C)이 이미 끄기로 했으므로 묻지 않는다. Electron 은 이 시그널을 `before-quit` 로 넘긴다.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, () => {
      quitPermission.allow()
      app.quit()
    })
  }
  ipcMain.on('app:restart', () => void restartFromMenu())
  const cli = cliAccess()
  const setup = { cli, zdotdir: resourceDir('zsh'), claudePlugin: resourceDir('claude-plugin') }
  // pane 의 셸과 같은 환경(LANG 보정 포함)으로 job 을 띄운다.
  const jobEnv = hostEnv()
  // job 은 host 를 거치지 않으므로, 앱을 끌 때 main 이 띄우던 job 을 직접 기다린다.
  const jobSpawns = new Set<Promise<void>>()
  let quitting = false
  const jobTable = createJobs({
    newId: newPtyId,
    cellOf: ptyCells.cellOf,
    spawn: async (id, cwd, command) => {
      await ready
      if (quitting) throw new Error('AI Maru is quitting')
      const spawned = startDir(cwd).then(async (dir) => {
        const state = await spawnPty(ptyBin(), ptyDir(), setup, id, dir, command, {
          keep: true,
          env: jobEnv
        })
        if (state === 'live') ptyStates.watch(id)
      })
      const settled = spawned.then(
        () => {},
        () => {}
      )
      jobSpawns.add(settled)
      void settled.then(() => jobSpawns.delete(settled))
      await spawned
    },
    waitExit: (id) => waitPtyExit(ptyDir(), id),
    capture: (id) => capturePty(ptyDir(), id, JOB_REPLY_MS),
    input: (id, text) => writePtyInput(ptyDir(), id, text, JOB_REPLY_MS),
    kill: (id) => killPty(ptyDir(), id),
    emit: monitor.emit,
    now: Date.now,
    changed: () => {
      store?.setJobs(jobTable.list())
      sendJobs()
      portWatch.update()
    }
  })
  jobs = jobTable
  const portWatch = createPortWatch({
    active: () => jobTable.running() > 0,
    measure: async () => {
      const running = jobTable.list().filter((j) => !j.exit)
      const pids = await Promise.all(running.map((j) => shellPidOf(j.pty)))
      const roots = new Map<string, number>()
      running.forEach((j, i) => pids[i] !== null && roots.set(j.pty, pids[i]))
      return readPorts(roots)
    },
    changed: () => sendJobs(),
    intervalMs: PORT_INTERVAL_MS
  })
  const jobViews = (): JobView[] =>
    jobTable.list().map(({ pty, name, cell, command, started, exit }) => ({
      pty,
      name,
      cell,
      command,
      started,
      exit,
      ports: portWatch.ports(pty)
    }))
  const sendJobs = (): void => sendToWindows('jobs:changed', jobViews())
  ipcMain.handle('jobs:list', () => jobViews())
  // 끝난 job 은 목록에서 지우기만 하므로 묻지 않는다.
  ipcMain.handle('job:kill', async (_event, pty: unknown) => {
    if (!isPtyId(pty)) return
    const { close } = await checkClose(async () => {
      const j = jobTable.get(pty)
      return j && !j.exit ? stopJobDialog(j.name ?? j.command[0]) : null
    })
    if (close) await jobTable.kill(pty)
  })
  // `leftovers` 의 `killPtys` 는 job pty 를 끄지 않으므로 그것을 기다리지 않고 되살린다.
  jobsRestored = plan.then((p) => {
    if (p.mode === 'full' && sessions) jobTable.restore(sessions.jobs)
  })
  void jobsRestored.then(() => store?.enable())
  // 터미널은 CLI 없이도 쓸 수 있어야 한다. env 는 그대로 넣어 CLI 가 앱에 닿지 않는다고 말하게 한다.
  const cliServer = listenCli(cli.socket, { ...cliHandlers, ...jobTable.handlers }).catch((err) => {
    console.error(`maru: cannot listen on ${cli.socket}:`, err)
    return null
  })
  // 셸이 뜨자마자 `maru` 를 불러도 닿게.
  const ready = Promise.all([leftovers, cliServer])
  ipcMain.on('pane:reply', (_event, id: number, reply: PaneReply) => panes.reply(id, reply))
  ipcMain.on('pane:ready', () => panes.ready())
  ipcMain.handle('git:head', (_event, cwd: unknown) =>
    typeof cwd === 'string' ? gitHead(cwd) : null
  )
  ipcMain.handle('pty:states', () => ptyStates.entries())
  ipcMain.on('pane:seen', (_event, pty: unknown) => {
    if (!isPtyId(pty)) return
    ptyStates.seen(pty)
    void seen(pty)
  })
  ipcMain.on('pane:viewed', (_event, pty: unknown) => {
    viewedPty = isPtyId(pty) ? pty : null
  })
  const linkOpener: LinkOpener = {
    openExternal: (url) => shell.openExternal(url),
    openPath: (path) => shell.openPath(path),
    putCanvas: (doc) => putCanvas(mainWindow, doc),
    foregroundCwd: (id) => foregroundCwd(ptyDir(), id)
  }
  ipcMain.handle('link:open', (_event, text: unknown, pty: unknown) => {
    if (typeof text !== 'string' || typeof pty !== 'string') {
      return { ok: false, reason: 'not a link' }
    }
    return openLink(text, pty, linkOpener)
  })
  ipcMain.handle('link:longest-existing', (_event, groups: unknown, pty: unknown) => {
    if (!Array.isArray(groups) || !groups.every(isPathCandidates) || typeof pty !== 'string') {
      return []
    }
    return longestExistingPaths(groups, pty, linkOpener)
  })
  ipcMain.on('window:path', (event, path: unknown) => {
    if (process.platform === 'darwin' && typeof path === 'string')
      BrowserWindow.fromWebContents(event.sender)?.setRepresentedFilename(path)
  })
  // open 과 같은 `ready.then` 으로 보내야 host 가 그 open 을 먼저 받는다.
  const sendKill = (key: string): void => {
    const closed = ptyCells.close(key)
    if (!closed) return
    // cell 의 마지막 pane 을 지우면 renderer 가 cell 도 지운다(docs/architecture.md).
    if (closed.closed) void jobTable.closeCell(closed.closed)
    ptyStates.forget(closed.pty)
    const req: KillRequest = { type: 'kill', id: closed.pty, dir: ptyDir() }
    void ready.then(() => ptyHost().postMessage(req))
  }
  // docs/architecture.md 의 "문서가 바뀌면 이전 문서의 pty 를 끈다".
  const opened = new Map<number, Set<string>>()
  app.on('web-contents-created', (_event, contents) => {
    let leaving = new Set<string>()
    // 이동이 시작된 뒤 새 문서가 연 pty 를 끄지 않게, 시작할 때 있던 pty 만 끈다.
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
  ipcMain.on('pty:open', (event, key: string, open: PtyOpen) => {
    const { id, cell, cwd, command, attach, keep } = open
    const keys = opened.get(event.sender.id) ?? new Set<string>()
    opened.set(event.sender.id, keys.add(key))
    ptyCells.open(key, id, cell)
    const { port1, port2 } = new MessageChannelMain()
    const req: OpenRequest = {
      type: 'open',
      id,
      cwd,
      command,
      attach,
      keep,
      dir: ptyDir(),
      bin: ptyBin(),
      setup
    }
    void ready.then(() => ptyHost().postMessage(req, [port1]))
    // host 에 넘기는 것(위 ready.then)보다 먼저 renderer 에 가야 한다 — renderer 는 포트보다 먼저 온
    // pty:lost 를 이 open 이전 host 의 것으로 보고 버린다(renderer/src/pty/connection.ts).
    event.sender.postMessage('pty:port', key, [port2])
  })

  ipcMain.on('pty:kill', (event, key: string) => {
    opened.get(event.sender.id)?.delete(key)
    sendKill(key)
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (mayQuit()) return
    event.preventDefault()
    confirmQuit()
  })
  // open 과 같은 `ready.then` 으로 보내야 host 가 그 앞의 open 을 먼저 받는다.
  const stopHost = (): Promise<void> =>
    ready.then(() => {
      const proc = host
      if (!proc) return
      return new Promise<void>((resolve) => {
        // 멈춘 host 를 기다리느라 앱이 꺼지지 않게 상한을 둔다. 그때 띄우던 pty 가운데 소켓을 연 pty 는 다음 실행의 정리가 끈다.
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
  // pty 는 앱과 따로 떠 있는 프로세스라 앱이 끝나도 남는다.
  let ptysKilled = false
  app.on('will-quit', (event) => {
    if (ptysKilled) return
    event.preventDefault()
    stopConfig()
    portWatch.stop()
    quitting = true
    void Promise.all([
      outcome === 'keep' ||
        Promise.all([
          stopHost(),
          // job 의 시작 폴더 확인(`startDir`)에는 시간 제한이 없다. 응답하지 않는 마운트에 있는 job 때문에 앱이 꺼지지 않을 수 있으므로, host 와 같은 상한까지만 기다린다.
          Promise.race([Promise.all(jobSpawns), sleep(QUIT_TIMEOUT_MS)])
        ]).then(() => killPtys(ptyDir())),
      cliServer.then((server) => server?.close())
    ]).finally(() => {
      ptysKilled = true
      app.quit()
    })
  })

  // 재시작은 renderer 를 거치지 않는다. renderer 가 멈췄을 때도 메뉴로 재시작할 수 있어야 하기 때문이다.
  installCommandMenu(
    (id) =>
      id === 'restart' ? void restartFromMenu() : mainWindow()?.webContents.send('command:run', id),
    { canRestart: !devServer }
  )
  createWindow(read.view.window ?? null)
}
