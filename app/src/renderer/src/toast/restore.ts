import type { RestoreNotice } from '../../../shared/screen'
import type { Toast } from './store'

export function restoreToast(notice: RestoreNotice): Toast {
  if (notice === 'layout')
    return {
      level: 'warning',
      title: "Couldn't restore the workspace layout",
      lines: ["The saved layout couldn't be read, so AI Maru didn't reopen the cells."]
    }
  if (notice === 'pins')
    return {
      level: 'warning',
      title: "Couldn't restore workspace pins",
      lines: [
        "The saved data for pinned workspaces couldn't be read. These workspaces lost their custom names and favorites and are no longer pinned. Those with no cells were removed."
      ]
    }
  const why =
    notice === 'protocol'
      ? 'At least one running terminal uses a different or unknown pty protocol version.'
      : "The saved terminal sessions couldn't be read."
  return {
    level: 'warning',
    title: "Couldn't reattach to the terminals",
    lines: [why, 'AI Maru ended the terminals and reopened the panes with new shells.']
  }
}
