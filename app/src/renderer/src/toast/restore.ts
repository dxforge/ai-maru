import type { RestoreNotice } from '../../../shared/screen'
import type { Toast } from './store'

export function restoreToast(notice: RestoreNotice): Toast {
  if (notice === 'workspaces')
    return {
      level: 'warning',
      title: "Couldn't restore workspace details",
      lines: [
        "The saved workspace names, pins and favorites couldn't be read. Workspaces are no longer pinned and have lost their custom names and favorites. Workspaces without cells were removed."
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
      lines: ["The saved panes couldn't be read, so AI Maru reopened each cell with a new shell."]
    }
  if (notice === 'recovered')
    return {
      level: 'info',
      title: 'Terminals moved to Recovered',
      lines: [
        "Running terminals that couldn't be matched to restored panes were opened in the Recovered workspace."
      ]
    }
  return {
    level: 'warning',
    title: "Couldn't reattach to the terminals",
    lines:
      notice === 'protocol'
        ? [
            'At least one running terminal uses a different or unknown pty protocol version.',
            'AI Maru ended those terminals and reopened the panes with new shells.'
          ]
        : [
            "The saved terminal sessions couldn't be read.",
            'AI Maru reopened the panes with new shells.'
          ]
  }
}
