import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { activePane, canvasSettled, canvasTitles, expect, panes, screen, split, test } from './app'

/** 경로를 셸 인자로 감싸는 규칙의 케이스는 `paths.test.ts` 가 sh·bash·zsh 를 실제로 돌려 잰다. 여기서는 드롭하거나 붙여넣은 경로를 셸이 경로마다 인자 하나로 읽는지만 본다. */
function makeFiles(dataDir: string): string[] {
  const dir = join(dataDir, 'drop dir')
  mkdirSync(dir)
  const file = join(dir, "it's $HOME (1) & `x`.png")
  writeFileSync(file, '')
  const folder = join(dir, 'a folder')
  mkdirSync(folder)
  return [file, folder]
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

/** `gap` 이면 pane 왼쪽 끝에서 2px, 곧 터미널 왼쪽 여백 4px 안에 떨어뜨린다. */
async function dropFiles(page: Page, i: number, files: string[], gap = false): Promise<void> {
  const box = (await panes(page).nth(i).locator('.terminal-view').boundingBox())!
  const x = gap ? (await panes(page).nth(i).boundingBox())!.x + 2 : box.x + box.width / 2
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
  const files = makeFiles(dataDir)
  const out = join(dataDir, 'drop-out')
  await armPrintf(page)
  await dropFiles(page, 0, files)
  expect(await readArgs(page, out)).toEqual([...files, 'END'])
})

test('파일을 터미널 왼쪽 여백에 드롭해도 경로가 붙는다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  const files = makeFiles(dataDir)
  const out = join(dataDir, 'drop-out')
  await armPrintf(page)
  await dropFiles(page, 0, files.slice(0, 1), true)
  expect(await readArgs(page, out)).toEqual([files[0], 'END'])
})

test('포커스가 없는 pane 에 드롭하면 그 pane 에 붙고 그 pane 이 포커스를 받는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
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

function writePng(dataDir: string, name: string): string {
  const png = join(dataDir, name)
  writeFileSync(png, Buffer.from(PNG_1X1, 'base64'))
  return png
}

function copyImage(png: string): void {
  execFileSync('osascript', [
    '-e',
    `set the clipboard to (read (POSIX file "${png}") as «class PNGf»)`
  ])
}

async function armRaw(page: Page, out: string, bracketed: boolean): Promise<void> {
  const [on, off] = bracketed ? [`printf '\\033[?2004h'; `, `; printf '\\033[?2004l'`] : ['', '']
  await page.keyboard.type(
    `${on}stty raw -echo; echo armed-$((1+1)); perl -e 'alarm 2; sysread STDIN,$b,64; print $b' > '${out}'; stty sane${off}\n`
  )
  await expect(screen(page)).toShow('armed-2')
}

const rawInput = (out: string) => () => existsSync(out) && readFileSync(out, 'latin1')

const canvasImageWidths = (page: Page) =>
  page
    .locator('.canvas .image')
    .evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalWidth))

test('이미지만 든 클립보드를 붙여넣으면 경로를 넣지 않고 xterm 이 빈 bracketed paste 를 보내며, Canvas 에 그 이미지가 뜬다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  copyImage(writePng(dataDir, 'shot.png'))

  const out = join(dataDir, 'raw-out')
  await armRaw(page, out, true)
  await paste(app)
  await expect.poll(rawInput(out)).toBe('\x1b[200~\x1b[201~')
  await expect(canvasTitles(page)).toHaveText(['Pasted image'])
  await expect.poll(() => canvasImageWidths(page)).toEqual([1])
})

test('같은 클립보드 이미지를 두 번 붙여넣으면 Canvas 에 문서가 둘 남는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  copyImage(writePng(dataDir, 'shot.png'))
  await paste(app)
  await expect(canvasTitles(page)).toHaveText(['Pasted image'])
  await paste(app)
  await expect(canvasTitles(page)).toHaveText(['Pasted image', 'Pasted image'])
})

test('⌃V 는 그대로 프로그램에 가고, 클립보드의 이미지가 Canvas 에 뜬다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  copyImage(writePng(dataDir, 'shot.png'))

  const out = join(dataDir, 'raw-out')
  await armRaw(page, out, false)
  await page.keyboard.press('Control+v')
  await expect.poll(rawInput(out)).toBe('\x16')
  await expect(canvasTitles(page)).toHaveText(['Pasted image'])
  await expect.poll(() => canvasImageWidths(page)).toEqual([1])
})

test('Finder 에서 복사하거나 드롭한 이미지 파일은 경로로 붙고, Canvas 에 파일 이름으로 뜬다', async ({
  launch,
  dataDir,
  defer
}) => {
  const { app, page } = await launch()
  const copied = writePng(dataDir, 'copied.png')
  const dropped = writePng(dataDir, 'dropped.png')

  const out = join(dataDir, 'paste-out')
  await armPrintf(page)
  await copyFiles([copied], defer)
  await paste(app)
  // 붙여넣은 이미지가 Canvas 를 여는 동안 드롭하면 드롭 지점을 Canvas 가 덮어 터미널이 드롭을 받지 못한다.
  // 붙여넣은 문서가 Canvas 에 뜨기 전에 드롭하면 두 문서의 순서도 바뀔 수 있다.
  await expect(canvasTitles(page)).toHaveText(['copied.png'])
  await canvasSettled(page)
  await dropFiles(page, 0, [dropped])
  expect(await readArgs(page, out)).toEqual([copied, dropped, 'END'])
  await expect(canvasTitles(page)).toHaveText(['dropped.png', 'copied.png'])
  await expect.poll(() => canvasImageWidths(page)).toEqual([1, 1])
})
