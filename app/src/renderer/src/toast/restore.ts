import type { Restore } from '../../../shared/screen'
import type { Toast } from './store'

export function restoreToast(notice: NonNullable<Restore['notice']>): Toast {
  if (notice === 'layout')
    return {
      level: 'warning',
      title: "Couldn't restore the workspace layout",
      lines: ["The saved layout couldn't be read, so AI Maru started with an empty screen."]
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
