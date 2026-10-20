import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { activePane, activeTerminal, expect, panes, rows, split, test } from './app'

const NAMES = ['plain.png', "it's $HOME (1) & `x`.png", '스크린샷 오후 3.04.05.png']

function makeFiles(dataDir: string): string[] {
  const dir = join(dataDir, 'drop dir')
  mkdirSync(dir)
  const files = NAMES.map((n) => {
    const p = join(dir, n)
    writeFileSync(p, '')
    return p
  })
  const folder = join(dir, 'a folder')
  mkdirSync(folder)
  return [...files, folder]
}

async function armPrintf(page: Page): Promise<void> {
  await page.keyboard.type(`printf '%s\\n' `)
}

/**
 * 끝 공백이 빠지면 `END` 가 마지막 경로에 붙으므로, 기대값의 `END` 가 끝 공백을 확인한다.
 */
async function readArgs(page: Page, out: string): Promise<string[]> {
  await page.keyboard.type(`END > '${out}'\n`)
  await expect.poll(() => existsSync(out) && readFileSync(out, 'utf8').endsWith('\n')).toBe(true)
  return readFileSync(out, 'utf8').split('\n').slice(0, -1)
}

async function dropFiles(page: Page, i: number, files: string[]): Promise<void> {
  const box = (await panes(page).nth(i).locator('.terminal-view').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const cdp = await page.context().newCDPSession(page)
  const data = { items: [], files, dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
    await cdp.send('Input.dispatchDragEvent', { type, x, y, data })
  await cdp.detach()
}

/** `osascript` 를 테스트가 끝날 때까지 종료하지 않는다. 클립보드에 쓴 프로세스가 끝나면 첫 항목만 남기 때문이다. */
async function copyFiles(files: string[], defer: (fn: () => void) => void): Promise<void> {
  const writer = spawn('osascript', [
    '-l',
    'JavaScript',
    '-e',
    `function run(argv) {
      ObjC.import('AppKit')
      const pb = $.NSPasteboard.generalPasteboard
      pb.clearContents
      const urls = $.NSMutableArray.array
      for (const p of argv) urls.addObject($.NSURL.fileURLWithPath(p))
      pb.writeObjects(urls)
      console.log('ready')
      delay(60)
    }`,
    ...files
  ])
  defer(() => writer.kill())
  await new Promise<void>((resolve, reject) => {
    writer.stderr.once('data', () => resolve())
    writer.once('exit', (code) => reject(new Error(`osascript exited with ${code}`)))
  })
}

async function paste(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste())
}

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('파일을 터미널에 드롭하면 셸이 경로마다 한 인자로 읽는 꼴로 붙는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  await activeTerminal(page)
  const files = makeFiles(dataDir)
  const out = join(dataDir, 'drop-out')
  await armPrintf(page)
  await dropFiles(page, 0, files)
  expect(await readArgs(page, out)).toEqual([...files, 'END'])
})

test('이름에 제어문자·개행이 든 파일을 드롭해도 쳐 둔 줄이 실행되지 않고 경로가 그대로 붙는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  await activeTerminal(page)
  const file = join(dataDir, 'ctl\u0016\nname')
  writeFileSync(file, '')
  const out = join(dataDir, 'drop-out')
  await armPrintf(page)
  await dropFiles(page, 0, [file])
  expect(await readArgs(page, out)).toEqual([...file.split('\n'), 'END'])
})

test('포커스가 없는 pane 에 드롭하면 그 pane 에 붙고 그 pane 이 포커스를 받는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await activeTerminal(page)
  const files = makeFiles(dataDir)
  const out = join(dataDir, 'drop-out')
  await armPrintf(page)
  await split(app, page, 'split-right', 2)
  await expect(panes(page).nth(1).locator('.terminal-view')).toHaveClass(/active/)

  await dropFiles(page, 0, files.slice(0, 1))
  await expect(activePane(page)).toHaveCount(1)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  expect(await readArgs(page, out)).toEqual([files[0], 'END'])
})

test('Finder 에서 복사한 파일을 붙여넣으면 경로로 붙고, 텍스트는 그대로 붙는다', async ({
  launch,
  dataDir,
  defer
}) => {
  const { app, page } = await launch()
  await activeTerminal(page)
  const files = makeFiles(dataDir)

  const out = join(dataDir, 'paste-out')
  await armPrintf(page)
  await copyFiles(files, defer)
  await paste(app)
  expect(await readArgs(page, out)).toEqual([...files, 'END'])

  const text = join(dataDir, 'text-out')
  await armPrintf(page)
  await app.evaluate(({ clipboard }) => clipboard.writeText('plain-text'))
  await paste(app)
  expect(await readArgs(page, text)).toEqual(['plain-textEND'])
})

test('이미지만 든 클립보드를 붙여넣으면 경로를 넣지 않고 xterm 이 빈 bracketed paste 를 보낸다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await activeTerminal(page)
  const png = join(dataDir, 'shot.png')
  writeFileSync(png, Buffer.from(PNG_1X1, 'base64'))
  execFileSync('osascript', [
    '-e',
    `set the clipboard to (read (POSIX file "${png}") as «class PNGf»)`
  ])

  const out = join(dataDir, 'raw-out')
  await page.keyboard.type(
    `printf '\\033[?2004h'; stty raw -echo; echo armed-$((1+1)); perl -e 'alarm 2; sysread STDIN,$b,64; print $b' > '${out}'; stty sane; printf '\\033[?2004l'\n`
  )
  await expect(rows(page)).toContainText('armed-2')
  await paste(app)
  await expect.poll(() => existsSync(out) && readFileSync(out, 'latin1')).toBe('\x1b[200~\x1b[201~')
})
