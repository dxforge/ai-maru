import type { Locator, Page } from '@playwright/test'
import {
  activeHeader,
  claudeConfig,
  claudeFile,
  claudeHook as hook,
  clickMenu,
  expect,
  newWorkspace,
  paneHeader,
  paneRows,
  pressNew,
  shellRows,
  split,
  test,
  typesInto,
  workspaceGroups as groups,
  workspaceItems
} from './app'

test('hook 이 오면 사이드바의 pane 줄과 pane 헤더의 상태가 바뀌고, claude exit 로 사라진다', async ({
  launch
}) => {
  const { page } = await launch()
  await expect(paneRows(page)).toHaveCount(0)
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(paneRows(page).locator('.title')).toHaveText('Claude')
  await expect(paneRows(page).locator('.state')).toHaveAttribute('title', 'Working')
  await expect(activeHeader(page).locator('.status-icon')).toHaveAttribute('title', 'Working')
  await expect(activeHeader(page)).toHaveClass(/working/)
  await page.keyboard.type("printf '\\e]0;task-%s\\a' $((6*7))\n")
  await expect(paneRows(page).locator('.title')).toHaveText('task-42')
  await expect(paneRows(page)).toHaveAttribute('aria-label', 'Working: task-42')
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(1)
  await page.keyboard.type(hook('PermissionRequest'))
  await expect(paneRows(page)).toHaveClass(/waiting/)
  await expect(paneRows(page)).toHaveAttribute('aria-label', /^Needs input: /)
  await expect(activeHeader(page)).toHaveClass(/waiting/)
  await page.keyboard.type(hook('Stop'))
  await expect(paneRows(page)).toHaveClass(/idle/)
  await expect(activeHeader(page)).toHaveClass(/idle/)
  await page.keyboard.type('"$MARU_CLI" claude exit\n')
  await expect(paneRows(page)).toHaveCount(0)
  await expect(activeHeader(page)).not.toHaveClass(/idle/)
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(0)
})

test('hook 없이 claude 의 상태 파일이 idle 이 되면 쉬는 중으로 돌아온다', async ({
  launch,
  dataDir
}) => {
  const config = claudeConfig(dataDir)
  const { page } = await launch()
  await page.keyboard.type(hook('UserPromptSubmit', { config }))
  await expect(paneRows(page)).toHaveClass(/working/)
  claudeFile(config, 1, 'c-1', 'idle', Date.now() + 60_000)
  await expect(paneRows(page)).toHaveClass(/idle/)
})

test('pane 줄은 그 터미널의 workspace 아래에만, pane 헤더는 보이는 pane 의 상태를 따른다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await pressNew(app)
  await expect(workspaceItems(page)).toHaveCount(2)
  await page.waitForSelector('.terminal-view.active .xterm-screen')
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(groups(page).nth(1).locator('.pane-row')).toHaveClass(/working/)
  await expect(groups(page).nth(0).locator('.pane-row')).toHaveClass(/shell/)
  await expect(activeHeader(page)).toHaveClass(/working/)
  await workspaceItems(page).nth(0).click()
  await expect(activeHeader(page)).not.toHaveClass(/working/)
  await workspaceItems(page).nth(1).click()
  await expect(activeHeader(page)).toHaveClass(/working/)
})

test('셸 pane 과 Claude pane 모두 pane 마다 줄이 있고, 포커스된 pane 의 줄만 밝다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  const [left, right] = [0, 1].map((i) => paneHeader(page, i))
  await expect(shellRows(page)).toHaveCount(2)
  await expect(shellRows(page)).toHaveClass([/^(?!.*focused)/, /focused/])
  await expect(shellRows(page).first()).toHaveAttribute('aria-label', 'Shell')
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(right).toHaveClass(/working/)
  await expect(left).not.toHaveClass(/working/)
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(paneRows(page)).toHaveClass(/focused/)
  await expect(shellRows(page)).toHaveCount(1)

  await clickMenu(app, 'focus-pane-left')
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(paneRows(page)).not.toHaveClass(/focused/)
  await expect(shellRows(page)).toHaveClass(/focused/)
  await clickMenu(app, 'focus-pane-right')
  await expect(paneRows(page)).toHaveClass(/focused/)
  await expect(shellRows(page)).not.toHaveClass(/focused/)
})

test('셸 pane 의 줄을 눌러도 그 pane 에 키 입력이 간다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)

  await shellRows(page).nth(0).click()

  await expect(shellRows(page).nth(0)).toHaveClass(/focused/)
  await typesInto(page, 0, 'shell-row')
})

test('pane 줄을 누르면 그 workspace 를 고르고 그 pane 에 키 입력이 간다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await clickMenu(app, 'focus-pane-left')
  await newWorkspace(launched, 2)

  await paneRows(page).click()
  await expect(groups(page).nth(0)).toHaveClass(/selected/)
  await expect(paneRows(page)).toHaveClass(/focused/)
  await typesInto(page, 1, 'row')

  await clickMenu(app, 'focus-pane-left')
  await expect(paneRows(page)).not.toHaveClass(/focused/)
  await paneRows(page).click()
  await expect(paneRows(page)).toHaveClass(/focused/)
  await typesInto(page, 1, 'same')
})

test('사이드바의 상태 아이콘과 Claude 아이콘은 잉크의 가운데를 행 가운데에서 0.5px 안에 그린다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(hook('Stop'))
  await split(app, page, 'split-down', 3)
  await page.keyboard.type(hook('PermissionRequest', { session: 'c-2' }))
  await expect(paneRows(page)).toHaveClass([/idle/, /waiting/])
  const shell = shellRows(page)
  const [idle, waiting] = [paneRows(page).nth(0), paneRows(page).nth(1)]

  for (const [row, icons] of [
    [shell, ['.state']],
    [idle, ['.state', '.app']],
    [waiting, ['.state', '.app']]
  ] as const) {
    for (const offset of await inkOffsets(page, row, icons))
      expect(Math.abs(offset)).toBeLessThanOrEqual(0.5)
  }
})

async function inkOffsets(page: Page, row: Locator, icons: readonly string[]): Promise<number[]> {
  const clip = (await row.boundingBox())!
  const boxes = await Promise.all(icons.map(async (s) => (await row.locator(s).boundingBox())!))
  const png = await page.screenshot({ clip, scale: 'device' })
  return page.evaluate(
    async ({ b64, clip, boxes }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, image.width, image.height).data
      const scale = image.width / clip.width
      const at = (x: number, y: number) => {
        const i = (y * image.width + x) * 4
        return [data[i], data[i + 1], data[i + 2]]
      }
      const background = at(image.width - 1, 0)
      return boxes.map((box) => {
        const inked = (y: number) => {
          for (
            let x = Math.floor((box.x - clip.x) * scale);
            x < (box.x + box.width - clip.x) * scale;
            x++
          )
            if (at(x, y).some((v, i) => Math.abs(v - background[i]) > 30)) return true
          return false
        }
        const rows = [...Array(image.height).keys()].filter(inked)
        return (rows[0] + rows[rows.length - 1] + 1) / 2 / scale - clip.height / 2
      })
    },
    { b64: png.toString('base64'), clip, boxes }
  )
}
