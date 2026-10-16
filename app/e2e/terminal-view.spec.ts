import { activeTerminal, expect, run, test } from './app'

test('alt screen 에 들어갔다 나와도 overview ruler canvas 가 보이지 않는다', async ({ launch }) => {
  const { page } = await launch()
  await activeTerminal(page)
  const ruler = page.locator('.terminal-view.active .xterm-decoration-overview-ruler')
  await expect(ruler).toHaveCount(1)
  await expect(ruler).toBeHidden()

  await run(page, "printf '\\e[?1049h'; sleep 0.3; printf '\\e[?1049l'; echo alt-$((1+1))", 'alt-2')

  await expect(ruler).toHaveCount(1)
  await expect(ruler).toBeHidden()
})
