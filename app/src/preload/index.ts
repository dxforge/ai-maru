import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CanvasItem } from '../shared/canvas'
import type { ConfigRead } from '../shared/config'
import type { CommandId } from '../shared/commands'
import type { GitHead } from '../shared/git'
import type { LinkOpenResult } from '../shared/link'
import type { CellNewRequest, CloseAnswer, PaneNewRequest, PaneReply } from '../shared/pane'
import type { ScreenState, ViewPrefs } from '../shared/screen'
import type { PtyOpen } from '../shared/pty'
import type { PtyStateEntry } from '../shared/pty-state'
import type { WindowTheme } from '../shared/theme'

// MessagePort 는 contextBridge 를 건너지 못해서 window.postMessage 로 넘긴다.
ipcRenderer.on('pty:port', (event, key: string) => {
  window.postMessage({ type: 'pty:port', key }, '*', event.ports)
})

ipcRenderer.on('pty:lost', () => {
  window.postMessage('pty:lost', '*')
})

const firstConfig = ipcRenderer.sendSync('config:read') as ConfigRead
let lastConfig: ConfigRead | undefined
let onConfig: ((read: ConfigRead) => void) | undefined
ipcRenderer.on('config:changed', (_event, read: ConfigRead) => {
  lastConfig = read
  onConfig?.(read)
})

const api = {
  openPty: (key: string, open: PtyOpen): void => ipcRenderer.send('pty:open', key, open),
  killPty: (key: string): void => ipcRenderer.send('pty:kill', key),
  onCommand: (cb: (id: CommandId) => void): void => {
    ipcRenderer.on('command:run', (_event, id: CommandId) => cb(id))
  },
  onCanvasPut: (cb: (item: CanvasItem) => void): void => {
    ipcRenderer.on('canvas:put', (_event, item: CanvasItem) => cb(item))
  },
  onPaneNew: (cb: (id: number, req: PaneNewRequest) => void): void => {
    ipcRenderer.on('pane:new', (_event, id: number, req: PaneNewRequest) => cb(id, req))
  },
  onPaneClose: (cb: (id: number, pty: string) => void): void => {
    ipcRenderer.on('pane:close', (_event, id: number, pty: string) => cb(id, pty))
  },
  onCellNew: (cb: (id: number, req: CellNewRequest) => void): void => {
    ipcRenderer.on('cell:new', (_event, id: number, req: CellNewRequest) => cb(id, req))
  },
  onPaneCancel: (cb: (id: number) => void): void => {
    ipcRenderer.on('pane:cancel', (_event, id: number) => cb(id))
  },
  paneReply: (id: number, reply: PaneReply): void => ipcRenderer.send('pane:reply', id, reply),
  /**
   * `onPaneNew`·`onPaneClose`·`onCellNew` 를 단 뒤에 부른다. main 은 이것을 받은 뒤에야 쌓아 둔
   * `pane:new`·`pane:close`·`cell:new` 를 보낸다.
   */
  paneReady: (): void => ipcRenderer.send('pane:ready'),
  gitHead: (cwd: string): Promise<GitHead | null> => ipcRenderer.invoke('git:head', cwd),
  /** main 이 pty 의 상태를 바꾸거나 지울 때마다 `cb` 를 부른다. `entry` 가 null 이면 지웠다. */
  onPtyState: (cb: (pty: string, entry: PtyStateEntry | null) => void): void => {
    ipcRenderer.on('pty:state', (_event, pty: string, entry: PtyStateEntry | null) =>
      cb(pty, entry)
    )
  },
  /** main 이 지금 든 pty 상태 전체. `onPtyState` 를 단 뒤에 부른다. */
  ptyStates: (): Promise<Record<string, PtyStateEntry>> => ipcRenderer.invoke('pty:states'),
  /** 터미널 링크를 연다. 상대경로는 `ptyId` 의 foreground 프로세스의 cwd 기준이다. */
  openLink: (text: string, ptyId: string): Promise<LinkOpenResult> =>
    ipcRenderer.invoke('link:open', text, ptyId),
  setWindowPath: (path: string): void => ipcRenderer.send('window:path', path),
  saveScreen: (screen: ScreenState): void => ipcRenderer.send('screen:state', screen),
  /**
   * 재시작으로 뜬 첫 문서만 화면을 받는다. 받은 화면에 workspace 가 있으면 renderer 는 `viewPrefs` 대신
   * 그 화면의 보기 모드와 사이드바 상태를 쓴다.
   */
  restoreScreen: (): Promise<ScreenState | null> => ipcRenderer.invoke('screen:restore'),
  /** 첫 화면을 그리기 전에 읽도록 동기로 받는다. */
  viewPrefs: ipcRenderer.sendSync('screen:prefs') as ViewPrefs,
  /** 첫 화면을 기본 글꼴로 그렸다가 다시 맞추지 않게 동기로 받는다. */
  config: firstConfig,
  /** `config` 다음에 main 이 읽은 값마다 `cb` 를 부른다. 등록하기 전에 온 값이 있으면 그 가운데 마지막 값으로 바로 부른다. */
  onConfig: (cb: (read: ConfigRead) => void): void => {
    onConfig = cb
    if (lastConfig) cb(lastConfig)
  },
  restart: (): void => ipcRenderer.send('app:restart'),
  /** pty 에서 셸 말고 도는 프로그램이 있으면 main 이 확인 창을 띄운다. */
  confirmClosePane: (ptyId: string): Promise<CloseAnswer> =>
    ipcRenderer.invoke('pane:confirm-close', ptyId),
  /** `workspaceId` 의 pane 가운데 프로그램이 도는 것이 있거나, 그 workspace 의 cell 에 끝나지 않은 job 이 있으면 main 이 확인 창을 띄운다. */
  confirmCloseWorkspace: (workspaceId: string): Promise<CloseAnswer> =>
    ipcRenderer.invoke('workspace:confirm-close', workspaceId),
  applyTheme: (theme: WindowTheme): void => ipcRenderer.send('theme:apply', theme),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  // dev 서버로 띄우면 Electron 이 끝날 때 dev 서버도 끝나, 다시 뜬 앱이 renderer 를 불러올 곳이 없다.
  canRestart: !process.env.ELECTRON_RENDERER_URL,
  // e2e 는 터미널 글자를 DOM renderer 가 그린 `.xterm-rows` 에서 읽는다.
  webgl: !process.env.MARU_DOM_RENDERER,
  home: process.env.HOME
}

export type MaruApi = typeof api

contextBridge.exposeInMainWorld('maru', api)
