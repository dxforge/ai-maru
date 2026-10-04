import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  shell,
  utilityProcess,
  type UtilityProcess
} from 'electron'
import { listenCli, type Handlers } from './cli-server'
import { appSocketPath, killSessions, utf8Locale, type CliAccess } from './session'
import type { OpenRequest } from './session-host'

function sessionDir(): string {
  return join(app.getPath('userData'), 's')
}

function coreBin(override: string | undefined, name: string): string {
  return override ?? join(app.getAppPath(), '../core/target/debug', name)
}

function sessionBin(): string {
  return coreBin(process.env.MARU_SESSION_BIN, 'maru-session')
}

function cliAccess(): CliAccess {
  return {
    socket: appSocketPath(sessionDir()),
    bin: coreBin(process.env.MARU_CLI_BIN, 'maru')
  }
}

const cliHandlers: Handlers = {
  ping: (_params, session) => ({ session })
}

const unobtrusive = Boolean(process.env.MARU_UNOBTRUSIVE)

function openExternal(url: string): void {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: !unobtrusive,
    focusable: !unobtrusive,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })
  win.webContents.on('will-navigate', (event, url) => {
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
    const win = BrowserWindow.getAllWindows()[0]
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  app.whenReady().then(start)
}

function start(): void {
  if (unobtrusive) app.dock?.hide()
  // 앱이 비정상으로 끝나 남은 세션이다. 새 세션은 그 정리가 끝난 뒤에 띄운다.
  const leftovers = killSessions(sessionDir())
  const cli = cliAccess()
  // 터미널은 CLI 없이도 쓸 수 있어야 한다. env 는 그대로 넣어 CLI 가 앱에 닿지 않는다고 말하게 한다.
  const cliServer = listenCli(cli.socket, cliHandlers).catch((err) => {
    console.error(`maru: cannot listen on ${cli.socket}:`, err)
    return null
  })
  // 셸이 뜨자마자 `maru` 를 불러도 닿게.
  const ready = Promise.all([leftovers, cliServer])
  ipcMain.on('session:open', (event) => {
    const { port1, port2 } = new MessageChannelMain()
    const req: OpenRequest = {
      type: 'open',
      owner: event.sender.id,
      dir: sessionDir(),
      bin: sessionBin(),
      cli
    }
    void ready.then(() => sessionHost().postMessage(req, [port1]))
    event.sender.postMessage('session:port', null, [port2])
  })

  app.on('window-all-closed', () => app.quit())
  // 세션은 앱과 따로 떠 있는 프로세스라 앱이 끝나도 남는다.
  let sessionsKilled = false
  app.on('will-quit', (event) => {
    if (sessionsKilled) return
    event.preventDefault()
    void Promise.all([
      killSessions(sessionDir()),
      cliServer.then((server) => server?.close())
    ]).finally(() => {
      sessionsKilled = true
      app.quit()
    })
  })

  createWindow()
}
