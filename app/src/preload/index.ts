import { contextBridge, ipcRenderer } from 'electron'

// MessagePort 는 contextBridge 를 건너지 못해서 window.postMessage 로 넘긴다.
ipcRenderer.on('session:port', (event) => {
  window.postMessage('session:port', '*', event.ports)
})

ipcRenderer.on('session:lost', () => {
  window.postMessage('session:lost', '*')
})

contextBridge.exposeInMainWorld('maru', {
  openSession: (): void => ipcRenderer.send('session:open')
})
