import { contextBridge, ipcRenderer } from 'electron'
import type { CanvasItem } from '../shared/canvas'

// MessagePort 는 contextBridge 를 건너지 못해서 window.postMessage 로 넘긴다.
ipcRenderer.on('session:port', (event, key: string) => {
  window.postMessage({ type: 'session:port', key }, '*', event.ports)
})

ipcRenderer.on('session:lost', () => {
  window.postMessage('session:lost', '*')
})

const api = {
  /** 살아 있는 세션의 id 를 띄운 순서로 준다. 이 창이 그 전에 연 연결은 모두 끊긴다. */
  restoreSessions: (): Promise<string[]> => ipcRenderer.invoke('session:restore'),
  openSession: (key: string, id?: string, cwd?: string): void =>
    ipcRenderer.send('session:open', key, id, cwd),
  onNewWorkspace: (cb: () => void): void => {
    ipcRenderer.on('workspace:new', () => cb())
  },
  onCanvasPut: (cb: (item: CanvasItem) => void): void => {
    ipcRenderer.on('canvas:put', (_event, item: CanvasItem) => cb(item))
  }
}

export type MaruApi = typeof api

contextBridge.exposeInMainWorld('maru', api)
