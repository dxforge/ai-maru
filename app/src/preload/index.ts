import { contextBridge, ipcRenderer } from 'electron'
import type { CanvasItem } from '../shared/canvas'
import type { ClaudeState } from '../shared/claude'
import type { CommandId } from '../shared/commands'
import type { GitHead } from '../shared/git'
import type { PaneNewRequest, PaneReply } from '../shared/pane'
import type { ScreenState } from '../shared/screen'
import type { SessionOpen } from '../shared/session'

// MessagePort 는 contextBridge 를 건너지 못해서 window.postMessage 로 넘긴다.
ipcRenderer.on('session:port', (event, key: string) => {
  window.postMessage({ type: 'session:port', key }, '*', event.ports)
})

ipcRenderer.on('session:lost', () => {
  window.postMessage('session:lost', '*')
})

const api = {
  openSession: (key: string, open: SessionOpen): void =>
    ipcRenderer.send('session:open', key, open),
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
  saveScreen: (screen: ScreenState): void => ipcRenderer.send('screen:state', screen),
  /** 재시작으로 뜬 첫 문서만 화면을 받는다. */
  restoreScreen: (): Promise<ScreenState | null> => ipcRenderer.invoke('screen:restore'),
  restart: (): void => ipcRenderer.send('app:restart'),
  // dev 서버로 띄우면 Electron 이 끝날 때 dev 서버도 끝나, 다시 뜬 앱이 renderer 를 불러올 곳이 없다.
  canRestart: !process.env.ELECTRON_RENDERER_URL,
  home: process.env.HOME
}

export type MaruApi = typeof api

contextBridge.exposeInMainWorld('maru', api)
