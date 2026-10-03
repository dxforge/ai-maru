import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    backgroundColor: '#1e1e1e'
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
