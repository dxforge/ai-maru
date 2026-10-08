import { Menu, type MenuItemConstructorOptions } from 'electron'
import { commands, type CommandId } from '../shared/commands'
import { commandKeys, roleKeys, toAccelerator, type MenuRole } from '../shared/shortcuts'

const separator: MenuItemConstructorOptions = { type: 'separator' }

function role(r: MenuRole): MenuItemConstructorOptions {
  const keys = roleKeys(r)
  return { role: r, accelerator: keys && toAccelerator(keys) }
}

export function installCommandMenu(run: (id: CommandId) => void): void {
  const commandItems = (menu: 'file' | 'view'): MenuItemConstructorOptions[] =>
    commands
      .filter((c) => c.menu === menu)
      .map((c) => {
        const keys = commandKeys(c.id)
        return {
          id: c.id,
          label: c.title,
          accelerator: keys && toAccelerator(keys),
          click: () => run(c.id)
        }
      })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: 'appMenu',
        submenu: [
          role('about'),
          separator,
          role('services'),
          separator,
          role('hide'),
          role('hideOthers'),
          role('unhide'),
          separator,
          role('quit')
        ]
      },
      { role: 'fileMenu', submenu: commandItems('file') },
      {
        role: 'editMenu',
        submenu: [
          role('undo'),
          role('redo'),
          separator,
          role('cut'),
          role('copy'),
          role('paste'),
          role('pasteAndMatchStyle'),
          role('delete'),
          role('selectAll'),
          separator,
          { label: 'Speech', submenu: [role('startSpeaking'), role('stopSpeaking')] }
        ]
      },
      {
        role: 'viewMenu',
        submenu: [
          ...commandItems('view'),
          separator,
          role('reload'),
          role('forceReload'),
          role('toggleDevTools'),
          separator,
          role('resetZoom'),
          role('zoomIn'),
          role('zoomOut'),
          separator,
          role('togglefullscreen')
        ]
      },
      {
        role: 'windowMenu',
        submenu: [role('minimize'), role('zoom'), separator, role('front')]
      }
    ])
  )
}
