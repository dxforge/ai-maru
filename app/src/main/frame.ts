export const TAG_TEXT = 1
export const TAG_BINARY = 2

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

  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    const frames: Frame[] = []
    while (this.buf.length >= HEADER_LEN) {
      const len = this.buf.readUInt32BE(1)
      if (len > MAX_FRAME_LEN) {
        throw new Error(`프레임 길이 ${len} 이 한도 ${MAX_FRAME_LEN} 을 넘는다`)
      }
      if (this.buf.length < HEADER_LEN + len) break
      frames.push({
        tag: this.buf.readUInt8(0),
        payload: this.buf.subarray(HEADER_LEN, HEADER_LEN + len)
      })
      this.buf = this.buf.subarray(HEADER_LEN + len)
    }
    return frames
  }
}
