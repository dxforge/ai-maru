import type { RestoreNotice } from '../../../shared/screen'
import type { Toast } from './store'

export function restoreToast(notice: RestoreNotice): Toast {
  if (notice === 'workspaces')
    return {
      level: 'warning',
      title: "Couldn't restore workspace details",
      lines: [
        "The saved workspace names, pins and favorites couldn't be read. Workspaces are no longer pinned and have lost their custom names and favorites. Pinned workspaces with no cells were removed."
      ]
    }
  if (notice === 'cells')
    return {
      level: 'warning',
      title: "Couldn't restore the cells",
      lines: ["The saved cells couldn't be read, so AI Maru didn't reopen them."]
    }
  if (notice === 'panes')
    return {
      level: 'warning',
      title: "Couldn't restore the panes",
      lines: [
        "The saved panes couldn't be read. AI Maru ended the terminals and reopened each cell with one new shell."
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
