import { existsSync, mkdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { appSocketPath } from '../src/main/session'
import { expect, rows, sessionDir, sockets, test } from './app'

test('터미널에서 maru ping 이 그 세션의 id 를 돌려받는다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await page.keyboard.type('maru ping\n')
  await expect(rows(page)).toContainText(/pong \(session s-/)
  const [sock] = sockets(dataDir)
  await expect(rows(page)).toContainText(`pong (session ${basename(sock, '.sock')})`)
})

test('시스템·rc 가 PATH 에 넣는 디렉토리에 다른 maru 가 없으면 로그인 셸을 지나도 maru 는 이 빌드의 CLI 다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const appPath = await app.evaluate(({ app }) => app.getAppPath())
  const bin = resolve(appPath, '../core/target/debug/maru')
  await page.keyboard.type(
    `test "$(command -v maru)" -ef '${bin}' && echo cli-$((1+1)) || echo cli-other\n`
  )
  await expect(rows(page)).toContainText('cli-2')
})

test('앱이 강제로 끝나 남은 앱 소켓이 있어도 다음에 켜면 maru 가 닿는다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  await first.page.keyboard.type('maru ping\n')
  await expect(rows(first.page)).toContainText('pong (session')
  const closed = new Promise<void>((resolve) => first.app.once('close', () => resolve()))
  first.app.process().kill('SIGKILL')
  await closed
  expect(existsSync(appSocketPath(sessionDir(dataDir)))).toBe(true)

  const { page } = await launch()
  await page.keyboard.type('maru ping; echo code-$?\n')
  await expect(rows(page)).toContainText('code-0')
})

test('앱 소켓을 열지 못해도 터미널은 뜨고, maru 는 앱에 닿지 않는다고 말한다', async ({
  launch,
  dataDir
}) => {
  mkdirSync(appSocketPath(sessionDir(dataDir)), { recursive: true })
  const { page } = await launch()
  await page.keyboard.type('maru ping; echo code-$?\n')
  await expect(rows(page)).toContainText('cannot reach the app')
  await expect(rows(page)).toContainText('code-1')
})
