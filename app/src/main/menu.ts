import { Menu, MenuItem } from 'electron'
import { commands, type CommandId } from '../shared/commands'

/**
 * 기본 메뉴의 Close Window 는 Close Pane 과 같은 ⌘W 라 뺀다. 메뉴의 항목은 지울 수 없어 메뉴를
 * 새로 짓는다.
 */
export function installCommandMenu(run: (id: CommandId) => void): void {
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  const rebuilt = new Menu()
  for (const top of menu.items) {
    const where = (['file', 'view'] as const).find((w) => top.role?.toLowerCase() === `${w}menu`)
    const items = commands.filter((c) => c.menu === where)
    if (!top.submenu || (!items.length && !top.submenu.items.some((i) => i.role === 'close'))) {
      rebuilt.append(top)
      continue
    }
    const submenu = new Menu()
    for (const c of items) {
      submenu.append(
        new MenuItem({
          id: c.id,
          label: c.title,
          accelerator: c.accelerator,
          click: () => run(c.id)
        })
      )
    }
    if (items.length) submenu.append(new MenuItem({ type: 'separator' }))
    for (const item of top.submenu.items) if (item.role !== 'close') submenu.append(item)
    rebuilt.append(new MenuItem({ role: top.role, label: top.label, submenu }))
  }
  Menu.setApplicationMenu(rebuilt)
}
