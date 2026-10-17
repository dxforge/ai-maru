import { contextBridge, ipcRenderer } from 'electron'
import type { CanvasItem } from '../shared/canvas'
import type { ClaudeState } from '../shared/claude'
import type { CommandId } from '../shared/commands'
import type { GitHead } from '../shared/git'
import type { PaneNewRequest, PaneReply } from '../shared/pane'

// MessagePort 는 contextBridge 를 건너지 못해서 window.postMessage 로 넘긴다.
ipcRenderer.on('session:port', (event, key: string) => {
  window.postMessage({ type: 'session:port', key }, '*', event.ports)
})

ipcRenderer.on('session:lost', () => {
  window.postMessage('session:lost', '*')
})

const api = {
  openSession: (key: string, id: string, cwd?: string, command?: string[]): void =>
    ipcRenderer.send('session:open', key, id, cwd, command),
  killSession: (key: string): void => ipcRenderer.send('session:kill', key),
  onCommand: (cb: (id: CommandId) => void): void => {
    ipcRenderer.on('command:run', (_event, id: CommandId) => cb(id))
  },
  onCanvasPut: (cb: (item: CanvasItem) => void): void => {
    ipcRenderer.on('canvas:put', (_event, item: CanvasItem) => cb(item))
  },
  /** 터미널 세션 id → 그 터미널에서 돌고 있는 claude 의 상태. */
  claudeStatuses: (): Promise<Record<string, ClaudeState>> => ipcRenderer.invoke('claude:statuses'),
  onClaudeStatus: (cb: (session: string, state: ClaudeState | null) => void): void => {
    ipcRenderer.on('claude:status', (_event, session: string, state: ClaudeState | null) =>
      cb(session, state)
    )
  },
  onPaneNew: (cb: (id: number, req: PaneNewRequest) => void): void => {
    ipcRenderer.on('pane:new', (_event, id: number, req: PaneNewRequest) => cb(id, req))
  },
  onPaneClose: (cb: (id: number, session: string) => void): void => {
    ipcRenderer.on('pane:close', (_event, id: number, session: string) => cb(id, session))
  },
  paneReply: (id: number, reply: PaneReply): void => ipcRenderer.send('pane:reply', id, reply),
  gitHead: (cwd: string): Promise<GitHead | null> => ipcRenderer.invoke('git:head', cwd),
  setWindowPath: (path: string): void => ipcRenderer.send('window:path', path),
  home: process.env.HOME
}

export type MaruApi = typeof api

contextBridge.exposeInMainWorld('maru', api)
