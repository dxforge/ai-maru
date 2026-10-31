import { describe, expect, it } from 'vitest'
import { CHORD_TIMEOUT_MS, chordStep, createChordKeys, type ChordKey } from './chord'

function press(code: string, key: string, mods: Partial<ChordKey> = {}): ChordKey {
  return {
    code,
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    ...mods
  }
}

const cmdJ = press('KeyJ', 'j', { metaKey: true })
const waiting = { since: 1000 }

describe('chordStep', () => {
  it('⌘J 를 누르면 그 키를 삼키고 두 번째 키를 기다린다', () => {
    expect(chordStep(null, cmdJ, 1000, true)).toEqual({ state: { since: 1000 }, consume: true })
  })

  it('앞 키를 받지 않는 때(입력창·팔레트)에는 ⌘J 를 그대로 둔다', () => {
    expect(chordStep(null, cmdJ, 1000, false)).toEqual({ state: null, consume: false })
  })

  it('IME 조합 중에 누른 ⌘J 는 받지 않는다', () => {
    expect(chordStep(null, { ...cmdJ, isComposing: true }, 1000, true)).toEqual({
      state: null,
      consume: false
    })
  })

  it('기다리지 않을 때 누른 다른 키는 그대로 둔다', () => {
    expect(chordStep(null, press('KeyT', 't', { metaKey: true }), 1000, true)).toEqual({
      state: null,
      consume: false
    })
  })

  it('⌘ 를 쥔 네 키는 그 자리를 여는 launch 명령이다', () => {
    const cases = [
      [press('KeyT', 't', { metaKey: true }), 'launch-cell'],
      [press('KeyN', 'n', { metaKey: true }), 'launch-workspace'],
      [press('KeyD', 'd', { metaKey: true }), 'launch-split-right'],
      [press('KeyD', 'D', { metaKey: true, shiftKey: true }), 'launch-split-down']
    ] as const
    for (const [e, run] of cases)
      expect(chordStep(waiting, e, 2000, true)).toEqual({ state: null, consume: true, run })
  })

  it('⌘ 를 뗀 T 와 Esc·다른 명령의 키·⌘J 는 삼키고 기다림을 끝낸다', () => {
    const keys = [
      press('KeyT', 't'),
      press('KeyD', 'D', { shiftKey: true }),
      press('Escape', 'Escape'),
      press('KeyP', 'p', { metaKey: true }),
      press('KeyT', 't', { metaKey: true, altKey: true }),
      cmdJ
    ]
    for (const e of keys)
      expect(chordStep(waiting, e, 2000, true), e.code).toEqual({
        state: null,
        consume: true,
        run: undefined
      })
  })

  it('입력창에서 시작하지 않는 때에도 기다리는 중이면 두 번째 키를 받는다', () => {
    expect(chordStep(waiting, press('KeyT', 't', { metaKey: true }), 2000, false).run).toBe(
      'launch-cell'
    )
  })

  it('modifier 만 누른 것은 두 번째 키가 아니다', () => {
    for (const key of ['Meta', 'Shift', 'Control', 'Alt'])
      expect(chordStep(waiting, press(`${key}Left`, key, { metaKey: true }), 2000, true)).toEqual({
        state: waiting,
        consume: false
      })
  })

  it('5초가 지나면 기다리지 않으므로 그 뒤의 ⌘T 는 그대로 둔다', () => {
    const cmdT = press('KeyT', 't', { metaKey: true })
    expect(chordStep(waiting, cmdT, 1000 + CHORD_TIMEOUT_MS - 1, true).run).toBe('launch-cell')
    expect(chordStep(waiting, cmdT, 1000 + CHORD_TIMEOUT_MS, true)).toEqual({
      state: null,
      consume: false
    })
  })

  it('5초가 지난 뒤의 ⌘J 는 새로 기다린다', () => {
    const now = 1000 + CHORD_TIMEOUT_MS
    expect(chordStep(waiting, cmdJ, now, true)).toEqual({ state: { since: now }, consume: true })
  })
})

describe('createChordKeys', () => {
  const cmdT = press('KeyT', 't', { metaKey: true })

  it('⌘J 를 쥐고 있어 반복해 오는 ⌘J 는 삼키고 계속 기다린다', () => {
    const keys = createChordKeys()
    keys.down(cmdJ, 1000, true)
    expect(keys.down({ ...cmdJ, repeat: true }, 1500, true)).toEqual({ consume: true })
    expect(keys.down(cmdT, 1600, true)).toEqual({ consume: true, run: 'launch-cell' })
  })

  it('두 번째 키를 쥐고 있어 반복해 오는 keydown 도 삼키고, 명령은 다시 돌리지 않는다', () => {
    const keys = createChordKeys()
    keys.down(cmdJ, 1000, true)
    keys.down(cmdT, 1100, true)
    expect(keys.down({ ...cmdT, repeat: true }, 1600, true)).toEqual({ consume: true })
    expect(keys.up('KeyT')).toBe(true)
    expect(keys.down(cmdT, 2000, true)).toEqual({ consume: false, run: undefined })
  })

  it('취소한 키를 쥐고 있어도 반복과 keyup 이 터미널에 가지 않는다', () => {
    const keys = createChordKeys()
    keys.down(cmdJ, 1000, true)
    const t = press('KeyT', 't')
    expect(keys.down(t, 1100, true)).toEqual({ consume: true, run: undefined })
    expect(keys.down({ ...t, repeat: true }, 1600, true)).toEqual({ consume: true })
    expect(keys.up('KeyT')).toBe(true)
    expect(keys.up('KeyT')).toBe(false)
  })

  it('삼키지 않은 키의 keyup 은 그대로 둔다', () => {
    const keys = createChordKeys()
    expect(keys.down(press('KeyA', 'a'), 1000, true)).toEqual({ consume: false, run: undefined })
    expect(keys.up('KeyA')).toBe(false)
  })

  it('창을 떠나면 기다리기를 그만두므로 돌아와 누른 ⌘T 는 그대로 둔다', () => {
    const keys = createChordKeys()
    keys.down(cmdJ, 1000, true)
    keys.up('KeyJ')
    keys.blur()
    expect(keys.down(cmdT, 1500, true)).toEqual({ consume: false, run: undefined })
  })
})
