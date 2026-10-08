import { expect, rows, test } from './app'

test('터미널에서 띄운 monitor 가 자기 세션으로 보낸 메시지를 JSON 한 줄로 받고, 긴 메시지는 read 로 읽힌다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type('"$MARU_CLI" claude monitor | cat &\n')
  await page.keyboard.type('sleep 1; maru inbox push "$MARU_SESSION_ID" "hello $((1+1))"\n')
  await expect(rows(page)).toContainText('"body":"hello 2"')
  await page.keyboard.type('maru inbox push "$MARU_SESSION_ID" "$(printf "y%.0s" $(seq 300))"\n')
  await expect(rows(page)).toContainText('"truncated":true')
  await page.keyboard.type('maru inbox read | head -c 30; echo; echo read-$((1+1))\n')
  await expect(rows(page)).toContainText('--- from s-')
  await expect(rows(page)).toContainText('read-2')
})

test('끝난 세션으로는 보내지 못한다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type('maru inbox push s-00000000 hi; echo code-$?\n')
  await expect(rows(page)).toContainText('session s-00000000 has ended')
  await expect(rows(page)).toContainText('code-1')
})
