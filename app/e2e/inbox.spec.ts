import { expect, rows, test } from './app'

test('터미널에서 띄운 monitor 가 자기 pty 로 보낸 메시지를 JSON 한 줄로 받고, 긴 메시지는 read 로 읽힌다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type('"$MARU_CLI" claude monitor | cat &\n')
  await page.keyboard.type('sleep 1; maru inbox push "$MARU_PTY_ID" "hello $((1+1))"\n')
  await expect(rows(page)).toContainText('"body":"hello 2"')
  await page.keyboard.type('maru inbox push "$MARU_PTY_ID" "$(printf "y%.0s" $(seq 300))"\n')
  await expect(rows(page)).toContainText('"truncated":true')
  await page.keyboard.type('maru inbox read | head -c 30; echo; echo read-$((1+1))\n')
  await expect(rows(page)).toContainText('--- from p-')
  await expect(rows(page)).toContainText('read-2')
})
