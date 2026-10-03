import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, MessageChannelMain, utilityProcess } from 'electron'
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

app.whenReady().then(() => {
  // 세션 바이트는 이 프로세스와 renderer 사이를 오가고 main 을 지나지 않는다 — 출력이
  // 쏟아질 때 main 이 막혀 창 조작까지 멈추지 않게.
  const host = utilityProcess.fork(join(__dirname, 'session-host.js'))

  ipcMain.on('session:open', (event) => {
    const { port1, port2 } = new MessageChannelMain()
    const req: OpenRequest = {
      type: 'open',
      dir: join(app.getPath('userData'), 's'),
      bin: sessionBin()
    }
    host.postMessage(req, [port1])
    event.sender.postMessage('session:port', null, [port2])
  })

  createWindow()
})
app.on('window-all-closed', () => app.quit())
