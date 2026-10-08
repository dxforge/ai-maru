import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { commands, type CommandId } from '../shared/commands'
import { commandKeys, menuKeys, toAccelerator, type MenuRole } from '../shared/shortcuts'

const separator: MenuItemConstructorOptions = { type: 'separator' }

function role(r: MenuRole): MenuItemConstructorOptions {
  const keys = menuKeys(r)
  return { role: r, accelerator: keys && toAccelerator(keys) }
}

// Electron 44 의 togglefullscreen role 은 macOS 메뉴에 같은 항목을 두 줄로 보인다(electron#49048).
const fullScreen: MenuItemConstructorOptions = {
  label: 'Toggle Full Screen',
  accelerator: toAccelerator(menuKeys('toggle-full-screen')!),
  click: (_item, win) => {
    if (win instanceof BrowserWindow) win.setFullScreen(!win.isFullScreen())
  }
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
          ...(app.isPackaged ? [] : [role('toggleDevTools'), separator]),
          role('resetZoom'),
          role('zoomIn'),
          role('zoomOut'),
          separator,
          fullScreen
        ]
      },
      {
        role: 'windowMenu',
        submenu: [role('minimize'), role('zoom'), separator, role('front')]
      }
    ])
  )
}
