import { TAG_BINARY, TAG_TEXT } from '../shared/protocol'

export { TAG_BINARY, TAG_TEXT }

const HEADER_LEN = 5
const MAX_FRAME_LEN = 16 * 1024 * 1024

export type Frame = { tag: number; payload: Buffer }

export function encodeFrame(tag: number, payload: Uint8Array): Buffer {
  const head = Buffer.alloc(HEADER_LEN)
  head.writeUInt8(tag, 0)
  head.writeUInt32BE(payload.byteLength, 1)
  return Buffer.concat([head, payload])
}

export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0)
  /** 프레임이 다 올 때까지 조각을 모은다 — 조각마다 합치면 큰 프레임에서 비용이 제곱으로 는다. */
  private pending: Buffer[] = []
  private pendingLen = 0
  private need = HEADER_LEN

  push(chunk: Buffer): Frame[] {
    this.pending.push(chunk)
    this.pendingLen += chunk.length
    if (this.buf.length + this.pendingLen < this.need) return []
    this.buf =
      this.buf.length === 0 && this.pending.length === 1
        ? chunk
        : Buffer.concat([this.buf, ...this.pending])
    this.pending = []
    this.pendingLen = 0
    const frames: Frame[] = []
    this.need = HEADER_LEN
    while (this.buf.length >= HEADER_LEN) {
      const len = this.buf.readUInt32BE(1)
      if (len > MAX_FRAME_LEN) {
        throw new Error(`프레임 길이 ${len} 이 한도 ${MAX_FRAME_LEN} 을 넘는다`)
      }
      if (this.buf.length < HEADER_LEN + len) {
        this.need = HEADER_LEN + len
        break
      }
      frames.push({
        tag: this.buf.readUInt8(0),
        payload: this.buf.subarray(HEADER_LEN, HEADER_LEN + len)
      })
      this.buf = this.buf.subarray(HEADER_LEN + len)
    }
    return frames
  }
}
