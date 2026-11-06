/**
 * 숨긴 창에서 xterm 이 처리하기 전에 처리했다고 알려 둘 수 있는 양. xterm 은 쓰기 버퍼가 50 MB 를 넘으면 출력을 버리므로 그 아래로 둔다.
 */
export const HIDDEN_AHEAD = 20_000_000

/**
 * xterm 이 처리한 출력의 바이트 수를 pty host 에 알린다. host 는 알리지 않은 양이 쌓이면 소켓을 읽지 않는다
 * (`main/bridge.ts`). 숨긴 창은 타이머가 드물게 돌아 xterm 이 출력을 거의 처리하지 못하므로, 그동안은 받은 즉시 알린다.
 * 셸이 숨긴 창의 처리 속도에 묶이지 않게 하려는 것이다.
 */
export class Acks {
  private written = 0
  private drawn = 0
  private acked = 0

  constructor(
    private readonly send: (bytes: number) => void,
    private readonly hidden: () => boolean
  ) {}

  wrote(bytes: number): void {
    this.written += bytes
    this.flush()
  }

  drew(bytes: number): void {
    this.drawn += bytes
    this.flush()
  }

  /** 창을 숨기거나 보일 때 부른다. 숨긴 뒤로 받거나 그린 것이 없어도 그리지 않은 양을 바로 알린다. */
  flush(): void {
    const upTo = this.hidden() ? Math.min(this.written, this.drawn + HIDDEN_AHEAD) : this.drawn
    if (upTo <= this.acked) return
    this.send(upTo - this.acked)
    this.acked = upTo
  }
}
