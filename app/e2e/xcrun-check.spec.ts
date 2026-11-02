import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkXcodeLicense, expect, test } from './app'

test('xcrun 확인이 테스트의 시간 제한보다 오래 걸려도 테스트는 시간 초과로 끝나지 않고, 확인에 쓴 시간만큼만 시간 제한이 늘어난다', async ({
  dataDir
}) => {
  test.setTimeout(2_000)
  writeFileSync(join(dataDir, 'xcrun'), '#!/bin/sh\n/bin/sleep 3\n')
  chmodSync(join(dataDir, 'xcrun'), 0o755)
  const started = Date.now()
  await checkXcodeLicense({ HOME: join(dataDir, 'home'), PATH: dataDir })
  const spent = Date.now() - started
  expect(spent).toBeGreaterThanOrEqual(3_000)
  expect(test.info().timeout).toBeGreaterThanOrEqual(2_000 + 3_000)
  expect(test.info().timeout).toBeLessThanOrEqual(2_000 + spent)
})
