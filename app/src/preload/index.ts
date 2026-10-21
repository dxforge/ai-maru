import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CanvasItem } from '../shared/canvas'
import type { ClaudeState } from '../shared/claude'
import type { CommandId } from '../shared/commands'
import type { GitHead } from '../shared/git'
import type { PaneNewRequest, PaneReply, WorkspaceNewRequest } from '../shared/pane'
import type { ScreenState, ViewPrefs } from '../shared/screen'
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
  onWorkspaceNew: (cb: (id: number, req: WorkspaceNewRequest) => void): void => {
    ipcRenderer.on('workspace:new', (_event, id: number, req: WorkspaceNewRequest) => cb(id, req))
  },
  onPaneCancel: (cb: (id: number) => void): void => {
    ipcRenderer.on('pane:cancel', (_event, id: number) => cb(id))
  },
  paneReply: (id: number, reply: PaneReply): void => ipcRenderer.send('pane:reply', id, reply),
  /**
   * `onPaneNew`·`onPaneClose`·`onWorkspaceNew` 를 단 뒤에 부른다. main 은 이것을 받은 뒤에야 쌓아 둔
   * `pane:new`·`pane:close`·`workspace:new` 를 보낸다.
   */
  paneReady: (): void => ipcRenderer.send('pane:ready'),
  gitHead: (cwd: string): Promise<GitHead | null> => ipcRenderer.invoke('git:head', cwd),
  setWindowPath: (path: string): void => ipcRenderer.send('window:path', path),
  saveScreen: (screen: ScreenState): void => ipcRenderer.send('screen:state', screen),
  /**
   * 재시작으로 뜬 첫 문서만 화면을 받는다. 받은 화면에 workspace 가 있으면 renderer 는 `viewPrefs` 대신
   * 그 화면의 보기 모드와 사이드바 상태를 쓴다.
   */
  restoreScreen: (): Promise<ScreenState | null> => ipcRenderer.invoke('screen:restore'),
  /** 첫 화면을 그리기 전에 읽도록 동기로 받는다. */
  viewPrefs: ipcRenderer.sendSync('screen:prefs') as ViewPrefs,
  restart: (): void => ipcRenderer.send('app:restart'),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  // dev 서버로 띄우면 Electron 이 끝날 때 dev 서버도 끝나, 다시 뜬 앱이 renderer 를 불러올 곳이 없다.
  canRestart: !process.env.ELECTRON_RENDERER_URL,
  // e2e 는 터미널 글자를 DOM renderer 가 그린 `.xterm-rows` 에서 읽는다.
  webgl: !process.env.MARU_DOM_RENDERER,
  home: process.env.HOME
}

export type MaruApi = typeof api

contextBridge.exposeInMainWorld('maru', api)
