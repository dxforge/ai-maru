import { Menu, MenuItem } from 'electron'
import { commands, type CommandId } from '../shared/commands'

export function installCommandMenu(run: (id: CommandId) => void): void {
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  for (const where of ['file', 'view'] as const) {
    const submenu = menu.items.find((item) => item.role?.toLowerCase() === `${where}menu`)?.submenu
    if (!submenu) continue
    const items = commands.filter((c) => c.menu === where)
    if (!items.length) continue
    items.forEach((c, i) =>
      submenu.insert(
        i,
        new MenuItem({
          id: c.id,
          label: c.title,
          accelerator: c.accelerator,
          click: () => run(c.id)
        })
      )
    )
    submenu.insert(items.length, new MenuItem({ type: 'separator' }))
  }
  Menu.setApplicationMenu(menu)
}
