import { describe, expect, it } from 'vitest'
import { encodeFrame, FrameDecoder, TAG_BINARY, TAG_TEXT } from './frame'

describe('FrameDecoder', () => {
  it('헤더 중간에서 잘려 온 프레임을 이어 붙인다', () => {
    const whole = encodeFrame(TAG_BINARY, Buffer.alloc(300, 7))
    const d = new FrameDecoder()
    expect(d.push(whole.subarray(0, 3))).toEqual([])
    const [frame] = d.push(whole.subarray(3))
    expect(frame.tag).toBe(TAG_BINARY)
    expect(frame.payload.length).toBe(300)
  })

  it('한 덩어리에 든 여러 프레임과 다음 프레임의 앞부분을 가른다', () => {
    const a = encodeFrame(TAG_TEXT, Buffer.from('{"type":"a"}'))
    const b = encodeFrame(TAG_BINARY, Buffer.from('xyz'))
    const c = encodeFrame(TAG_TEXT, Buffer.from('{}'))
    const d = new FrameDecoder()
    const first = d.push(Buffer.concat([a, b, c.subarray(0, 4)]))
    expect(first.map((f) => [f.tag, f.payload.toString()])).toEqual([
      [TAG_TEXT, '{"type":"a"}'],
      [TAG_BINARY, 'xyz']
    ])
    expect(d.push(c.subarray(4)).map((f) => f.payload.toString())).toEqual(['{}'])
  })

  it('빈 페이로드도 프레임 하나다', () => {
    const [frame] = new FrameDecoder().push(encodeFrame(TAG_BINARY, new Uint8Array()))
    expect(frame.payload.length).toBe(0)
  })

  it('한도를 넘는 길이는 페이로드를 기다리지 않고 거절한다', () => {
    const head = Buffer.alloc(5)
    head.writeUInt8(TAG_BINARY, 0)
    head.writeUInt32BE(16 * 1024 * 1024 + 1, 1)
    expect(() => new FrameDecoder().push(head)).toThrow()
  })
})
