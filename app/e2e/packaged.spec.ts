import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, rows, test } from './app'

let installed: string
let installDir: string

// 체크아웃 밖, 이름에 공백이 든 경로에서 띄워야 설치한 앱과 같은 조건이 된다.
test.beforeAll(() => {
  const built = process.env.MARU_PACKAGED_APP
  if (!built) throw new Error('MARU_PACKAGED_APP is not set — run pnpm test:e2e:packaged')
  installDir = mkdtempSync(join(tmpdir(), 'maru-packaged-'))
  installed = join(installDir, basename(built))
  execFileSync('cp', ['-c', '-R', built, installed])
})

test.afterAll(() => {
  rmSync(installDir, { recursive: true, force: true })
})

function executable(): string {
  return join(installed, 'Contents/MacOS', basename(installed, '.app'))
}

test('체크아웃 밖에 둔 설치본이 AI Maru 로 떠 터미널을 열고, maru ping 이 앱에 닿는다', async ({
  launch
}) => {
  const { app, page } = await launch({}, executable())
  expect(await app.evaluate(({ app }) => app.getName())).toBe('AI Maru')
  await page.keyboard.type('maru ping\n')
  await expect(rows(page)).toContainText(/pong \(session s-/)
})

test('설치본의 터미널에서 maru 는 번들 안의 CLI 다', async ({ launch }) => {
  const { page } = await launch({}, executable())
  const bin = join(installed, 'Contents/Resources/bin/maru')
  await page.keyboard.type(
    `test "$(command -v maru)" -ef '${bin}' && echo cli-$((1+1)) || echo cli-other\n`
  )
  await expect(rows(page)).toContainText('cli-2')
})
