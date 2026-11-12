import { describe, expect, it } from 'vitest'
import {
  createDesktopNotifications,
  NOTIFICATION_INTERVAL_MS,
  SAME_NOTIFICATION_INTERVAL_MS,
  type DesktopNotice
} from './desktop-notification'

function setup(
  labels: Record<string, string> = { 'p-1': 'claude', 'p-2': 'zsh' },
  statuses: Record<string, string> = {}
) {
  let now = 10_000
  let focused = false
  const shown: { notice: DesktopNotice; click: () => void }[] = []
  const opened: string[] = []
  const notify = createDesktopNotifications({
    now: () => now,
    focused: () => focused,
    label: (pty) => labels[pty],
    status: (pty) => statuses[pty],
    show: (_pty, notice, click) => void shown.push({ notice, click }),
    open: (pty) => void opened.push(pty)
  })
  return {
    notify,
    shown,
    opened,
    advance: (ms: number) => void (now += ms),
    focus: (f: boolean) => void (focused = f)
  }
}

describe('createDesktopNotifications', () => {
  it('제목은 알림 제목(없으면 pane 이름), 부제는 pane 이름으로 띄운다', () => {
    const t = setup()
    t.notify('p-1', { title: 'Tests', body: '3 failed' })
    t.advance(NOTIFICATION_INTERVAL_MS)
    t.notify('p-2', { title: '', body: 'build done' })
    expect(t.shown.map((s) => s.notice)).toEqual([
      { title: 'Tests', subtitle: 'claude', body: '3 failed' },
      { title: 'zsh', subtitle: 'zsh', body: 'build done' }
    ])
  })

  it('글 없는 알림은 제목에 pane 이름을, 본문에 그 pane 의 상태를 쓰고, 상태가 없으면 본문을 비운다', () => {
    const t = setup(undefined, { 'p-1': 'approve Bash: ls' })
    t.notify('p-1', { title: '', body: '' })
    t.advance(NOTIFICATION_INTERVAL_MS)
    t.notify('p-2', { title: '', body: '' })
    expect(t.shown.map((s) => s.notice)).toEqual([
      { title: 'claude', subtitle: 'claude', body: 'approve Bash: ls' },
      { title: 'zsh', subtitle: 'zsh', body: '' }
    ])
  })

  it('글이 있는 알림은 상태를 쓰지 않는다', () => {
    const t = setup(undefined, { 'p-1': 'approve Bash: ls' })
    t.notify('p-1', { title: 'Tests', body: '' })
    expect(t.shown[0].notice).toEqual({ title: 'Tests', subtitle: 'claude', body: '' })
  })

  it('글 없는 알림의 같은 알림 제한은 본문에 쓴 상태로 가른다', () => {
    const statuses: Record<string, string> = { 'p-1': 'approve Bash: ls' }
    const t = setup(undefined, statuses)
    t.notify('p-1', { title: '', body: '' })
    t.advance(NOTIFICATION_INTERVAL_MS)
    t.notify('p-1', { title: '', body: '' })
    expect(t.shown).toHaveLength(1)
    statuses['p-1'] = 'Idle'
    t.notify('p-1', { title: '', body: '' })
    expect(t.shown.map((s) => s.notice.body)).toEqual(['approve Bash: ls', 'Idle'])
  })

  it('같은 알림 제한은 띄운 제목으로 가른다 — 다른 pane 의 글 없는 알림은 상태가 같아도 띄운다', () => {
    const t = setup(undefined, { 'p-1': 'Idle', 'p-2': 'Idle' })
    t.notify('p-1', { title: '', body: '' })
    t.advance(NOTIFICATION_INTERVAL_MS)
    t.notify('p-2', { title: '', body: '' })
    expect(t.shown.map((s) => s.notice)).toEqual([
      { title: 'claude', subtitle: 'claude', body: 'Idle' },
      { title: 'zsh', subtitle: 'zsh', body: 'Idle' }
    ])
  })

  it('pane 이름을 모르면 부제를 비우고 알림 제목만 쓴다', () => {
    const t = setup({})
    t.notify('p-9', { title: '', body: 'x' })
    expect(t.shown[0].notice).toEqual({ title: '', subtitle: '', body: 'x' })
  })

  it('앱 창이 포커스되어 있으면 띄우지 않고, 그 알림은 빈도 제한에 세지 않는다', () => {
    const t = setup()
    t.focus(true)
    t.notify('p-1', { title: 'a', body: 'b' })
    expect(t.shown).toEqual([])
    t.focus(false)
    t.notify('p-1', { title: 'a', body: 'b' })
    expect(t.shown).toHaveLength(1)
  })

  it('앱 전체에서 1초에 하나만 띄우고, 그 사이의 알림은 버린다', () => {
    const t = setup()
    t.notify('p-1', { title: 'a', body: '1' })
    t.advance(NOTIFICATION_INTERVAL_MS - 1)
    t.notify('p-2', { title: 'b', body: '2' })
    expect(t.shown).toHaveLength(1)
    t.advance(1)
    t.notify('p-2', { title: 'c', body: '3' })
    expect(t.shown.map((s) => s.notice.body)).toEqual(['1', '3'])
  })

  it('마지막으로 띄운 것과 제목·본문이 같으면 5초가 지나야 다시 띄운다', () => {
    const t = setup()
    t.notify('p-1', { title: 'a', body: 'same' })
    t.advance(SAME_NOTIFICATION_INTERVAL_MS - 1)
    t.notify('p-2', { title: 'a', body: 'same' })
    expect(t.shown).toHaveLength(1)
    t.notify('p-2', { title: 'a', body: 'other' })
    expect(t.shown).toHaveLength(2)
    t.advance(NOTIFICATION_INTERVAL_MS)
    t.notify('p-2', { title: 'a', body: 'other' })
    expect(t.shown).toHaveLength(2)
    t.advance(SAME_NOTIFICATION_INTERVAL_MS - NOTIFICATION_INTERVAL_MS)
    t.notify('p-2', { title: 'a', body: 'other' })
    expect(t.shown).toHaveLength(3)
  })

  it('알림을 누르면 그 알림을 보낸 pty 를 연다', () => {
    const t = setup()
    t.notify('p-1', { title: 'a', body: '1' })
    t.advance(NOTIFICATION_INTERVAL_MS)
    t.notify('p-2', { title: 'b', body: '2' })
    t.shown[0].click()
    expect(t.opened).toEqual(['p-1'])
  })
})
