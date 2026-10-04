import { contextBridge, ipcRenderer } from 'electron'
import type { CanvasItem } from '../shared/canvas'

// MessagePort 는 contextBridge 를 건너지 못해서 window.postMessage 로 넘긴다.
ipcRenderer.on('session:port', (event) => {
  window.postMessage('session:port', '*', event.ports)
})

ipcRenderer.on('session:lost', () => {
  window.postMessage('session:lost', '*')
})

const api = {
  openSession: (): void => ipcRenderer.send('session:open'),
  onCanvasPut: (cb: (item: CanvasItem) => void): void => {
    ipcRenderer.on('canvas:put', (_event, item: CanvasItem) => cb(item))
  }
}

export type MaruApi = typeof api

contextBridge.exposeInMainWorld('maru', api)
