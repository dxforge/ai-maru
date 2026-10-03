import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  utilityProcess,
  type UtilityProcess
} from 'electron'
import type { OpenRequest } from './session-host'

function sessionBin(): string {
  return process.env.MARU_SESSION_BIN ?? join(app.getAppPath(), '../core/target/debug/maru-session')
}

function createWindow(): void {
  // e2e 가 띄운 창이 쓰고 있는 사람의 키 입력을 가로채지 않게.
  const inactive = Boolean(process.env.MARU_SHOW_INACTIVE)
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: !inactive,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })
  if (inactive) win.showInactive()
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let host: UtilityProcess | null = null

/**
 * 세션 바이트는 이 프로세스와 renderer 사이를 오가고 main 을 지나지 않는다 — 출력이 쏟아질 때
 * main 이 막혀 창 조작까지 멈추지 않게.
 */
function sessionHost(): UtilityProcess {
  if (!host) {
    const proc = utilityProcess.fork(join(__dirname, 'session-host.js'), [], {
      serviceName: 'maru-session-host'
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
  ipcMain.on('session:open', (event) => {
    const { port1, port2 } = new MessageChannelMain()
    const req: OpenRequest = {
      type: 'open',
      owner: event.sender.id,
      dir: join(app.getPath('userData'), 's'),
      bin: sessionBin()
    }
    sessionHost().postMessage(req, [port1])
    event.sender.postMessage('session:port', null, [port2])
  })

  createWindow()
}

app.on('window-all-closed', () => app.quit())
