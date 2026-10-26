import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createConnection, type AddressInfo, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { encodeFrame, TAG_TEXT } from '../src/main/frame'
import { appSocketPath, killPtys, runDir } from '../src/main/pty'
import type { CanvasMarkdown } from '../src/shared/canvas'
import { PROTOCOL_VERSION } from '../src/shared/protocol'
import type { PtyOpen } from '../src/shared/pty'

export { expect }

export type Launched = { app: ElectronApplication; page: Page }

export type CanvasItem =
  CanvasMarkdown | { id: string; kind: 'image'; name: string; mime: string; svg: string }

export async function putCanvas(app: ElectronApplication, item: CanvasItem): Promise<void> {
  await app.evaluate(({ BrowserWindow }, item) => {
    const msg =
      item.kind === 'image'
        ? {
            id: item.id,
            kind: item.kind,
            name: item.name,
            mime: item.mime,
            bytes: Buffer.from(item.svg)
          }
        : item
    BrowserWindow.getAllWindows()[0].webContents.send('canvas:put', msg)
  }, item)
}

type Fixtures = {
  dataDir: string
  launch: (
    env?: Record<string, string>,
    executablePath?: string,
    args?: string[]
  ) => Promise<Launched>
  defer: (fn: () => void) => void
}

export const test = base.extend<Fixtures>({
  // playwright 는 첫 인자가 객체 분해 패턴인지 보고 주입할 fixture 를 정하므로 `{}` 를 지우면 안 된다.
  // eslint-disable-next-line no-empty-pattern
  dataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-e2e-'))
    // 대부분의 테스트가 single 에서 시작한다고 가정하므로, 새 dataDir 에 보기 모드를 single 로 써 둔다. 기본값(columns)을 재는 테스트는 이 파일을 지운다.
    writeFileSync(join(dir, 'window-state.json'), JSON.stringify({ viewMode: 'single' }))
    await use(dir)
    // 앱을 강제로 끝낸 테스트는 pty 를 남긴다.
    await killPtys(ptyDir(dir))
    rmSync(runBase(dir), { recursive: true, force: true, maxRetries: 3 })
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  },
  launch: async ({ dataDir }, use) => {
    const apps: ElectronApplication[] = []
    await use(async (env = {}, executablePath, args = []) => {
      const launched = await launchApp(dataDir, env, executablePath, args)
      apps.push(launched.app)
      return launched
    })
    for (const app of apps) {
      // 프로그램이나 job 이 남은 채 끝난 테스트에서는 앱이 끝나기 전에 확인 창을 띄운다. 확인 창에 막히지 않게 Quit 로 답하게 한다.
      await stubDialog(app, 0).catch(() => {})
      await app.close().catch(() => {})
    }
  },
  // eslint-disable-next-line no-empty-pattern
  defer: async ({}, use) => {
    const fns: (() => void)[] = []
    await use((fn) => fns.push(fn))
    for (const fn of fns) fn()
  }
})

async function launchApp(
  dataDir: string,
  env: Record<string, string>,
  executablePath: string | undefined,
  args: string[]
): Promise<Launched> {
  const inherited = { ...process.env }
  // 패키징한 앱이 번들 안의 바이너리를 쓰는지 봐야 하므로 바깥의 덮어쓰기를 물려주지 않는다.
  if (executablePath) {
    delete inherited.MARU_PTY_BIN
    delete inherited.MARU_CLI_BIN
  }
  const app = await electron.launch({
    executablePath,
    // Playwright 의 기본 colorScheme 은 `prefers-color-scheme` 을 light 로 고정해, renderer 가 `nativeTheme.themeSource` 를 따르지 못한다.
    colorScheme: null,
    args: [...(executablePath ? [] : ['.']), `--user-data-dir=${dataDir}`, ...args],
    env: {
      ...inherited,
      MARU_UNOBTRUSIVE: '1',
      MARU_DOM_RENDERER: '1',
      SHELL: '/bin/bash',
      BASH_SILENCE_DEPRECATION_WARNING: '1',
      // 개발자의 `~/.ai-maru/config.toml` 을 읽지 않도록 테스트마다 다른 폴더를 준다. 폴더가 없는 채로 띄우는 테스트가 있으므로 폴더는 만들지 않는다.
      MARU_CONFIG_DIR: join(dataDir, 'config'),
      // 개발자의 `~/.ai-maru/run` 에 테스트마다 디렉토리를 남기지 않게 한다.
      MARU_RUN_DIR: runBase(dataDir),
      ...env
    } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.xterm-screen')
  return { app, page }
}

export async function stubDialog(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, response) => {
    const calls: unknown[] = []
    Object.assign(globalThis, { dialogCalls: calls })
    dialog.showMessageBox = (async (opts: unknown) => {
      calls.push(opts)
      return { response, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, response)
}

export type DialogCall = { message: string; detail: string; buttons: string[] }

export function dialogCalls(app: ElectronApplication): Promise<DialogCall[]> {
  return app.evaluate(() => (globalThis as unknown as { dialogCalls: DialogCall[] }).dialogCalls)
}

export async function closeWindow(app: ElectronApplication): Promise<void> {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
}

export function configFile(dataDir: string): string {
  return join(dataDir, 'config', 'config.toml')
}

export function writeConfig(dataDir: string, text: string): void {
  mkdirSync(join(dataDir, 'config'), { recursive: true })
  writeFileSync(configFile(dataDir), text)
}

/** 셸의 `$PWD` 와 견줄 수 있게 심볼릭 링크를 푼 경로를 준다. */
export function zshHome(dataDir: string, ...dirs: string[]): string {
  const home = join(dataDir, 'home')
  mkdirSync(home)
  for (const dir of dirs) mkdirSync(join(home, dir), { recursive: true })
  writeFileSync(join(home, '.zshrc'), "PS1='%# '\nMARK=rc-$((1+1))\n")
  return realpathSync(home)
}

export function wrapPtyBin(dataDir: string, name: string, prelude: string): string {
  const real = process.env.MARU_PTY_BIN ?? join(__dirname, '../../core/target/debug/maru-pty')
  const bin = join(dataDir, name)
  writeFileSync(bin, `#!/bin/sh\n${prelude}\nexec '${real}' "$@"\n`)
  chmodSync(bin, 0o755)
  return bin
}

export function slowPtyBin(dataDir: string, then = ''): string {
  return wrapPtyBin(dataDir, 'slow-pty', `sleep 1.5\n${then}`)
}

export function hostPid(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ app }) => app.getAppMetrics().find((m) => m.name === 'maru-pty-host')!.pid)
}

/** `--` 뒤에 명령을 받은 pty 만 stderr 에 `boom-2` 를 쓰고 실패한다. 처음 pane 의 셸은 뜬다. */
export function failingCommandPtyBin(dataDir: string): string {
  return wrapPtyBin(
    dataDir,
    'failing-pty',
    `case " $* " in *" -- "*) echo "boom-$((1+1))" >&2; exit 1;; esac`
  )
}

export async function delayPtyPort(app: ElectronApplication, ms: number): Promise<void> {
  await app.evaluate(({ ipcMain }, ms) => {
    const [open] = ipcMain.listeners('pty:open')
    ipcMain.removeAllListeners('pty:open')
    ipcMain.on('pty:open', (event, ...args) => {
      const sender = event.sender
      const late = Object.create(event, {
        sender: {
          value: {
            postMessage: (...msg: Parameters<typeof sender.postMessage>) =>
              setTimeout(() => sender.postMessage(...msg), ms)
          }
        }
      })
      open(late, ...args)
    })
  }, ms)
}

export type PtyEvents = { opens: (PtyOpen & { key: string })[]; kills: string[] }

export async function recordPtys(app: ElectronApplication): Promise<() => Promise<PtyEvents>> {
  await app.evaluate(({ ipcMain }) => {
    const events: PtyEvents = { opens: [], kills: [] }
    Object.assign(globalThis, { ptyEvents: events })
    ipcMain.prependListener('pty:open', (_event, key, open) => events.opens.push({ key, ...open }))
    ipcMain.prependListener('pty:kill', (_event, key) => events.kills.push(key))
  })
  return () => app.evaluate(() => (globalThis as unknown as { ptyEvents: PtyEvents }).ptyEvents)
}

function runBase(dataDir: string): string {
  // `os.tmpdir()` 가 길면 그 아래 dataDir 의 소켓 경로가 한도(macOS 103바이트)를 넘으므로, 길이가 정해진 `/tmp` 아래에 둔다.
  return join(
    '/tmp',
    `maru-e2e-run-${createHash('sha256').update(dataDir).digest('hex').slice(0, 8)}`
  )
}

export function ptyDir(dataDir: string): string {
  // Electron 은 `--user-data-dir` 의 심볼릭 링크를 풀어(`/var` → `/private/var`) userData 로 쓰므로 그 경로로 해시한다.
  return runDir(realpathSync(dataDir), { MARU_RUN_DIR: runBase(dataDir) })
}

export function ptyFiles(dataDir: string): string[] {
  try {
    return readdirSync(ptyDir(dataDir)).sort()
  } catch {
    return []
  }
}

export function sockets(dataDir: string): string[] {
  return ptyFiles(dataDir)
    .filter((n) => n.endsWith('.sock'))
    .map((n) => join(ptyDir(dataDir), n))
    .filter((p) => p !== appSocketPath(ptyDir(dataDir)))
}

function request(v: object): Buffer {
  const body = JSON.stringify({ ...v, protocol_version: PROTOCOL_VERSION })
  return encodeFrame(TAG_TEXT, Buffer.from(body))
}

export function attachFromOutside(sockPath: string, cols: number, rows: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(sockPath, () => {
      sock.write(request({ type: 'attach', role: 'primary', cols, rows }))
      resolve(sock)
    })
    sock.on('data', () => {})
    sock.on('error', reject)
  })
}

// xterm 이 그리는 canvas 가운데 render layer 가 아닌 것이 WebGL renderer 의 것이다.
export const WEBGL_CANVAS = '.xterm-screen > canvas:not([class*="-layer"])'

// 앱의 테마 배경(GHOSTTY). 이 색과 다른 픽셀을 글자가 그려진 픽셀로 본다.
export const GROUND = [0x28, 0x2c, 0x34]

export function isInk(data: number[], i: number): boolean {
  return (
    Math.abs(data[i] - GROUND[0]) +
      Math.abs(data[i + 1] - GROUND[1]) +
      Math.abs(data[i + 2] - GROUND[2]) >
    96
  )
}

export async function cellSize(page: Page): Promise<{ width: number; height: number }> {
  return page.locator('.panes.selected').evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      width: parseFloat(s.getPropertyValue('--cell')),
      height: parseFloat(s.getPropertyValue('--row'))
    }
  })
}

export type Box = { x: number; y: number; width: number; height: number }

export type Pixels = { width: number; height: number; data: number[] }

export async function screenshotPixels(
  page: Page,
  clip: Box,
  scale: 'css' | 'device' = 'device'
): Promise<Pixels> {
  const png = await page.screenshot({ clip, scale })
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    return { width: image.width, height: image.height, data: [...data] }
  }, png.toString('base64'))
}

export function panes(page: Page) {
  return page.locator('.panes.selected .pane')
}

export async function paneBox(page: Page, i: number) {
  return (await panes(page).nth(i).boundingBox())!
}

export function paneTerminalRows(page: Page, i: number) {
  return panes(page).nth(i).locator('.xterm-rows')
}

export function activePane(page: Page) {
  return page.locator('.pane:has(.terminal-view.active)')
}

/**
 * claude 가 보내는 것과 같은 OSC 7501 바이트를 pane 의 셸에서 PTY 출력으로 내보내 pty 프로세스가 받게 한다.
 */
export function programStatus(state: string, extra?: string, app = 'claude-code'): string {
  const fields = [`state=${state}`, app && `app=${app}`, extra].filter(Boolean).join(':')
  return `printf '\\033]7501;${fields}\\033\\\\'\n`
}

export function activeHeader(page: Page) {
  return activePane(page).locator('.pane-header')
}

export async function toggleView(
  { app, page }: Launched,
  mode: 'single' | 'columns'
): Promise<void> {
  await clickMenu(app, 'toggle-view-mode')
  await expect(page.locator('.terminals')).toHaveClass(new RegExp(mode))
}

export function cellViews(page: Page) {
  return page.locator('.panes')
}

export function paneHeader(page: Page, i: number) {
  return panes(page).nth(i).locator('.pane-header')
}

export function rows(page: Page) {
  return page.locator('.terminal-view.active .xterm-rows')
}

let sizeMarker = 0

/** 폭이 바뀐 직후의 크기는 셸이 SIGWINCH 를 받기 전일 수 있어 기대한 열 수가 될 때까지 다시 잰다. */
export async function expectCols(page: Page, cols: number): Promise<void> {
  await expect.poll(async () => (await shellSize(page)).cols).toBe(cols)
}

export async function shellSize(page: Page): Promise<{ rows: number; cols: number }> {
  const marker = `size${++sizeMarker}`
  await page.keyboard.type(`clear; echo ${marker}=$(stty size | tr ' ' x)\n`)
  const re = new RegExp(`${marker}=(\\d+)x(\\d+)`)
  let m: RegExpMatchArray | null = null
  await expect.poll(async () => (m = (await rows(page).innerText()).match(re))).not.toBeNull()
  return { rows: Number(m![1]), cols: Number(m![2]) }
}

/** WebGL 로 그리면 `.xterm-rows` 가 없어 셸이 본 크기를 파일로 받는다. */
export async function sttySize(
  page: Page,
  dataDir: string
): Promise<{ rows: number; cols: number }> {
  const out = join(dataDir, `size${++sizeMarker}`)
  await page.keyboard.type(`stty size > ${out}\n`)
  let size: string | undefined
  await expect
    .poll(() => (size = existsSync(out) ? readFileSync(out, 'utf8').trim() : undefined))
    .toMatch(/^\d+ \d+$/)
  const [rows, cols] = size!.split(' ').map(Number)
  return { rows, cols }
}

export async function activeTerminal(page: Page): Promise<void> {
  await page.waitForSelector('.terminal-view.active .xterm-screen')
}

export async function run(page: Page, command: string, expected: string | RegExp): Promise<void> {
  await page.keyboard.type(`${command}\n`)
  await expect(rows(page)).toContainText(expected)
}

export async function typesInto(page: Page, i: number, marker: string): Promise<void> {
  await expect(panes(page).nth(i).locator('.terminal-view')).toHaveClass(/active/)
  await run(page, `echo ${marker}-$((1+1))`, `${marker}-2`)
}

export async function setZoom(app: ElectronApplication, level: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, level) => BrowserWindow.getAllWindows()[0].webContents.setZoomLevel(level),
    level
  )
}

export function gridRows(page: Page) {
  return rows(page).locator('> div')
}

export function cellItems(page: Page) {
  return page.locator('.sidebar .cell .name')
}

export function cellGroups(page: Page) {
  return page.locator('.sidebar .group')
}

export function workspaceNames(page: Page) {
  return page.locator('.sidebar .workspace-name')
}

export function paneRows(page: Page) {
  return page.locator('.sidebar .pane-row:not(.shell)')
}

export function shellRows(page: Page) {
  return page.locator('.sidebar .pane-row.shell')
}

// Playwright 의 키 입력은 macOS 메뉴를 거치지 않아 메뉴 항목을 직접 누른다.
export async function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id)
}

// pty 가 다 뜨기 전에 재시작하면 다시 뜬 앱이 그 pty 에 붙을지가 시점에 달리므로, 부르는 쪽이 셸이 답한
// 것을 본 뒤에 부른다.
export async function restartWith(
  app: ElectronApplication,
  trigger: () => Promise<void> = () => clickMenu(app, 'restart')
): Promise<void> {
  await app.evaluate(({ app }) => {
    app.relaunch = () => {}
  })
  const closed = app.waitForEvent('close')
  await trigger()
  await closed
}

export async function pressNew(app: ElectronApplication): Promise<void> {
  await clickMenu(app, 'new-workspace')
}

async function openFromMenu(
  { app, page }: Launched,
  id: 'new-workspace' | 'new-cell',
  cellCount: number
): Promise<void> {
  await clickMenu(app, id)
  await expect(cellItems(page)).toHaveCount(cellCount)
  await activeTerminal(page)
}

export async function newWorkspace(launched: Launched, cellCount: number): Promise<void> {
  await openFromMenu(launched, 'new-workspace', cellCount)
}

export async function newCell(launched: Launched, cellCount: number): Promise<void> {
  await openFromMenu(launched, 'new-cell', cellCount)
}

export const marked = (name: string): string => `bash -c 'echo mark-${name}; read x'`

export async function split(
  app: ElectronApplication,
  page: Page,
  id: 'split-right' | 'split-down',
  count: number
): Promise<void> {
  await clickMenu(app, id)
  await expect(panes(page)).toHaveCount(count)
  await activeTerminal(page)
}

export async function openPalette({ app, page }: Launched): Promise<void> {
  await clickMenu(app, 'command-palette')
  await expect(page.locator('.palette .query')).toBeFocused()
}

export async function resizeBy(app: ElectronApplication, dw: number, dh: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, [dw, dh]) => {
      const win = BrowserWindow.getAllWindows()[0]
      const [w, h] = win.getContentSize()
      win.setContentSize(w + dw, h + dh)
    },
    [dw, dh]
  )
}

export async function resizeGridTo(
  app: ElectronApplication,
  page: Page,
  cells: number
): Promise<void> {
  const cell = await cellSize(page)
  const grid = (await page.locator('.panes.selected .grid').boundingBox())!
  await resizeBy(app, Math.round(cells * cell.width - grid.width), 0)
}

export async function cellWidth(page: Page, i = 0): Promise<number> {
  return (await cellViews(page).nth(i).boundingBox())!.width
}

export async function sidebarWidth(page: Page): Promise<number> {
  return (await page.locator('.side').boundingBox())!.width
}

export function sidebarResizer(page: Page): Locator {
  return page.locator('.side + .resizer')
}

export function canvasPanel(page: Page): Locator {
  return page.locator('.canvas')
}

export function canvasTitles(page: Page): Locator {
  return page.locator('.canvas .list button')
}

export function toast(page: Page): Locator {
  return page.locator('.toast')
}

export function canvasResizer(page: Page): Locator {
  return page.locator('.resizer:has(+ .canvas)')
}

export async function openCanvas({ app, page }: Launched): Promise<void> {
  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'first' })
  await expect(canvasPanel(page)).toBeVisible()
  await expect.poll(() => canvasPanel(page).evaluate((el) => el.getAnimations().length)).toBe(0)
}

export async function canvasWidth(page: Page): Promise<number> {
  return (await canvasPanel(page).boundingBox())!.width
}

type Grab = { button?: 'left' | 'right' }

export async function grabHandle(
  page: Page,
  handle: Locator,
  dx: number,
  { button = 'left' }: Grab = {}
): Promise<void> {
  const box = (await handle.boundingBox())!
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  await page.mouse.move(x, y)
  await page.mouse.down({ button })
  await page.mouse.move(x + dx, y, { steps: 4 })
}

export async function dragHandle(
  page: Page,
  handle: Locator,
  dx: number,
  grab: Grab = {}
): Promise<void> {
  await grabHandle(page, handle, dx, grab)
  await page.mouse.up({ button: grab.button ?? 'left' })
}

export async function dragCanvas(page: Page, dx: number): Promise<number> {
  const width = (await canvasWidth(page)) - dx
  await dragHandle(page, canvasResizer(page), dx)
  await expect.poll(() => canvasWidth(page)).toBe(width)
  return width
}

export async function watchTerminalWidths(page: Page): Promise<() => Promise<number[]>> {
  await page.evaluate(() => {
    const widths: number[] = []
    Object.assign(window, { widths })
    new ResizeObserver(([e]) => widths.push(e.contentRect.width)).observe(
      document.querySelector('.terminal-view.active .xterm-screen')!
    )
  })
  const widths = (): Promise<number[]> =>
    page.evaluate(() => (window as unknown as { widths: number[] }).widths)
  await expect.poll(widths).toHaveLength(1)
  return widths
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2'
}

/** 이 주소를 `ELECTRON_RENDERER_URL` 로 주면 앱이 dev 서버에서 뜬 것처럼 동작한다. */
export async function serveRenderer(defer: (fn: () => void) => void): Promise<string> {
  const root = join(__dirname, '../out/renderer')
  const server = createServer((req, res) => {
    const path = normalize(new URL(req.url!, 'http://x').pathname)
    const file = join(root, path === '/' ? 'index.html' : path)
    if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end()
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  defer(() => server.close())
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
}

/**
 * Playwright 의 입력은 OS 의 창 끌기를 거치지 않는다. 그래서 테스트는 main 이 hit test 에 쓰는 drag
 * 영역을 Electron 의 디버그 로그에서 읽는다. 이 env 로 띄운 앱에 `dragRegion` 을 쓴다.
 */
export const DRAG_LOG_ENV = {
  ELECTRON_ENABLE_LOGGING: '1',
  ELECTRON_DEBUG_DRAGGABLE_REGIONS: '1'
}

/** 이 함수를 부른 뒤로 main 이 받은 마지막 drag 영역의 경계 상자(`x,y wxh`, 비었으면 `0,0 0x0`)를 준다. */
export function dragRegion(app: ElectronApplication): () => string | undefined {
  let last: string | undefined
  app.process().stderr!.on('data', (chunk: Buffer) => {
    for (const m of chunk.toString().matchAll(/\[draggable-regions\].*update #.*bounds (\S+ \S+)/g))
      last = m[1]
  })
  return () => last
}
