import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from '../shared/protocol'

/**
 * 이 앱의 프로토콜 버전이다. 테스트는 `MARU_TEST_PROTOCOL_VERSION` 으로 이 값을 올려, 앱 버전과 레코드 버전이 다른 pty 에
 * 붙는 경로를 지금의 `maru-pty` 로 시험한다.
 */
export function appProtocol(): number {
  const v = Number(process.env.MARU_TEST_PROTOCOL_VERSION)
  return Number.isInteger(v) && v > 0 ? v : PROTOCOL_VERSION
}

export function inProtocolRange(v: unknown, range: { min: number; max: number }): v is number {
  return Number.isInteger(v) && (v as number) >= range.min && (v as number) <= range.max
}

export function attachable(v: unknown): v is number {
  return inProtocolRange(v, { min: MIN_PROTOCOL_VERSION, max: appProtocol() })
}
