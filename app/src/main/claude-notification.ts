import type { PtyNotification } from '../shared/pty-state'
import { InvalidParams, optionalString, type Handlers } from './cli-server'

/** 상태 레코드(OSC 7501)가 같은 내용을 보이는 종류다. 이 종류는 알림의 글을 싣지 않는다. */
const SHOWN_BY_STATUS: ReadonlySet<string> = new Set([
  'idle_prompt',
  'permission_prompt',
  'elicitation_dialog'
])

/** MCP elicitation 에 사용자가 답하거나 취소·거절한 직후 오는 종류다. 사용자가 방금 한 일을 되풀이하므로 pty 에 넣지 않는다. */
const ELICITATION_RESPONSE = 'elicitation_response'

/** maru-pty 가 OSC 알림의 텍스트를 다듬는 규칙(`line_text`)과 같게 한 줄로 다듬는다. */
export function lineText(text: string): string {
  return (
    text
      .replace(/[\n\t]/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
      .trim()
  )
}

/** 앱 plugin 의 Notification hook 이 보낸 claude 알림을 그 pty 에 넣는다. */
export function claudeNotificationHandlers(
  notify: (pty: string, notification: PtyNotification) => void
): Handlers {
  return {
    'claude.notification': (params, pty) => {
      const message = optionalString(params.message, 'message')
      if (message === undefined) throw new InvalidParams('params.message must be a string')
      const type = optionalString(params.type, 'type')
      const title = optionalString(params.title, 'title')
      if (type === ELICITATION_RESPONSE) return null
      if (type !== undefined && SHOWN_BY_STATUS.has(type)) {
        notify(pty, { title: '', body: '' })
        return null
      }
      const n = { title: lineText(title ?? ''), body: lineText(message) }
      if (n.title || n.body) notify(pty, n)
      return null
    }
  }
}
