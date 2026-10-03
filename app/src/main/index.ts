import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  utilityProcess,
  type UtilityProcess
} from 'electron'
import { killSessions, utf8Locale } from './session'
import type { OpenRequest } from './session-host'

function sessionDir(): string {
  return join(app.getPath('userData'), 's')
}

function sessionBin(): string {
  return process.env.MARU_SESSION_BIN ?? join(app.getAppPath(), '../core/target/debug/maru-session')
}

const unobtrusive = Boolean(process.env.MARU_UNOBTRUSIVE)

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
  ipcMain.on('session:open', (event) => {
    const { port1, port2 } = new MessageChannelMain()
    const req: OpenRequest = {
      type: 'open',
      owner: event.sender.id,
      dir: sessionDir(),
      bin: sessionBin()
    }
    void leftovers.then(() => sessionHost().postMessage(req, [port1]))
    event.sender.postMessage('session:port', null, [port2])
  })

  app.on('window-all-closed', () => app.quit())
  // 세션은 앱과 따로 떠 있는 프로세스라 앱이 끝나도 남는다.
  let sessionsKilled = false
  app.on('will-quit', (event) => {
    if (sessionsKilled) return
    event.preventDefault()
    void killSessions(sessionDir()).finally(() => {
      sessionsKilled = true
      app.quit()
    })
  })

  createWindow()
}
