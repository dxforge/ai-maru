import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

// asar 헤더: [4B][헤더 pickle 크기 4B][pickle 본문 크기 4B][JSON 길이 4B][JSON]
function asarTopLevel(asar: string): string[] {
  const buf = readFileSync(asar)
  const length = buf.readUInt32LE(12)
  const header = JSON.parse(buf.subarray(16, 16 + length).toString('utf8'))
  return Object.keys(header.files)
}

// main 이 런타임에 불러오는 패키지가 생기면 이 테스트를 그 패키지만 허용하게 바꾼다.
test('설치본의 app.asar 에 node_modules 가 없다', () => {
  expect(asarTopLevel(join(installed, 'Contents/Resources/app.asar'))).not.toContain('node_modules')
})

test('설치본의 터미널에서 maru 는 번들 안의 CLI 다', async ({ launch }) => {
  const { page } = await launch({}, executable())
  const bin = join(installed, 'Contents/Resources/bin/maru')
  await page.keyboard.type(
    `test "$(command -v maru)" -ef '${bin}' && echo cli-$((1+1)) || echo cli-other\n`
  )
  await expect(rows(page)).toContainText('cli-2')
})
