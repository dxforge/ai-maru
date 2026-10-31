import type { CommandId } from '../../shared/commands'
import { chordCommand, chordPrefix, matchesKeys, type KeyEventLike } from '../../shared/shortcuts'

// VS Code 가 chord 의 두 번째 키를 기다리는 시간(`abstractKeybindingService.ts` 의 `_scheduleLeaveChordMode`)과 같다.
export const CHORD_TIMEOUT_MS = 5000

const MODIFIERS = new Set(['Meta', 'Shift', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'Fn'])

export type ChordKey = KeyEventLike & { key: string; repeat: boolean; isComposing: boolean }

export type ChordState = { since: number } | null

/** `consume` 이면 그 키를 터미널·메뉴 어디에도 보내지 않는다. `run` 은 chord 가 맞았을 때 돌릴 명령이다. */
export type ChordStep = { state: ChordState; consume: boolean; run?: CommandId }

/** 기다리는 동안 누른 키는 맞든 안 맞든 삼키고 기다림을 끝낸다 — VS Code 의 방식이다. modifier 만 누른 것은 두 번째 키가 아니다. */
export function chordStep(
  state: ChordState,
  e: ChordKey,
  now: number,
  canStart: boolean
): ChordStep {
  if (state && now - state.since < CHORD_TIMEOUT_MS) {
    if (MODIFIERS.has(e.key)) return { state, consume: false }
    return { state: null, consume: true, run: chordCommand(e) }
  }
  if (canStart && !e.isComposing && matchesKeys(e, chordPrefix))
    return { state: { since: now }, consume: true }
  return { state: null, consume: false }
}

export type ChordKeys = {
  down(e: ChordKey, now: number, canStart: boolean): { consume: boolean; run?: CommandId }
  /** 삼킬 keyup 이면 true 다. */
  up(code: string): boolean
  blur(): void
}

export function createChordKeys(): ChordKeys {
  let state: ChordState = null
  // 키를 뗄 때도 알리는 kitty 키보드 모드의 프로그램이 누름 없는 반복·뗌을 받지 않게, 삼킨 키를 쥐고 있어 반복해 오는
  // keydown 과 그 키의 keyup 도 삼킨다.
  const swallowed = new Set<string>()
  return {
    down(e, now, canStart) {
      if (e.repeat && swallowed.has(e.code)) return { consume: true }
      const step = chordStep(state, e, now, canStart)
      state = step.state
      if (step.consume) swallowed.add(e.code)
      else swallowed.delete(e.code)
      return { consume: step.consume, run: step.run }
    },
    up: (code) => swallowed.delete(code),
    blur() {
      state = null
    }
  }
}
