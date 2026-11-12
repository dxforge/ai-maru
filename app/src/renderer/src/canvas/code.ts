import type { HighlightRequest, HighlightResponse } from './highlight.worker'

/**
 * 그릴 글자와 줄 수. CRLF 는 LF 로 바꾼다 — shiki 는 CRLF 를 줄 하나로 나누므로, 줄 번호와 강조한 줄이 어긋나지 않게
 * 그리는 글자도 같게 맞춘다. 끝의 줄바꿈 하나는 줄로 세지 않는다.
 */
export function prepareCode(text: string): { code: string; count: number } {
  const code = text.replace(/\r\n/g, '\n').replace(/\n$/, '')
  return { code, count: code.split('\n').length }
}

export function clampLine(line: number | undefined, count: number): number | undefined {
  if (line === undefined || line < 1) return undefined
  return Math.min(line, count)
}

export class CodeBody {
  static #count = 0
  readonly id = ++CodeBody.#count
  readonly code: string
  readonly count: number
  readonly line: number | undefined

  constructor(
    text: string,
    readonly name: string,
    line?: number
  ) {
    const { code, count } = prepareCode(text)
    this.code = code
    this.count = count
    this.line = clampLine(line, count)
  }

  #scrolled = false
  /** 처음 부를 때만 true 다. 카드를 접었다 펴면 그 줄로 다시 스크롤하지 않고 카드 자리를 지킨다. */
  firstScroll(): boolean {
    if (this.#scrolled) return false
    return (this.#scrolled = true)
  }

  #numbers: string | undefined
  get numbers(): string {
    return (this.#numbers ??= Array.from({ length: this.count }, (_, i) => i + 1).join('\n'))
  }

  #highlighted: Promise<string | null> | undefined
  /** 받아 둔 강조. 아직 받지 못했으면 undefined, 강조하지 않으면 null 이다. */
  html: string | null | undefined

  highlighted(): Promise<string | null> {
    return (this.#highlighted ??= (
      this.code.length > HIGHLIGHT_MAX_CHARS ? Promise.resolve(null) : highlight(this)
    ).then((html) => (this.html = html)))
  }

  ready(ms: number): Promise<void> {
    return Promise.race([
      this.highlighted().then(
        () => {},
        () => {}
      ),
      new Promise<void>((resolve) => setTimeout(resolve, ms))
    ])
  }
}

/**
 * worker 를 띄우고 작은 조각을 강조해 둔다. 처음 하는 tokenize 는 같은 크기의 두 번째보다 약 0.2초 더 걸려(빌드한 앱에서
 * TypeScript 5KB 225ms, 두 번째 24ms), 처음 여는 코드 문서가 그만큼 늦게 강조되기 때문이다. 첫 비용은 파일이 처음 쓰는
 * 문법 규칙마다 들어, 작은 조각으로는 다 치르지 못한다(데운 뒤에도 TypeScript 5KB 를 처음 열면 196~214ms).
 */
export function warmHighlighter(): void {
  void new CodeBody('const a = 1\n', 'warm.ts').highlighted()
}

/**
 * 이보다 긴 파일은 강조 없이 둔다. 강조한 HTML 을 붙이고 다음 프레임까지 TypeScript 250KB 는 0.14초, 500KB 는 0.30초가 걸려,
 * 0.2초 안에 드는 쪽을 골랐다.
 */
export const HIGHLIGHT_MAX_CHARS = 250 * 1024

let worker: Worker | undefined
const waiting = new Map<number, (html: string | null) => void>()

function highlighter(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = ({ data }: MessageEvent<HighlightResponse>) => {
    waiting.get(data.id)?.(data.html)
    waiting.delete(data.id)
  }
  // worker 를 띄우지 못하면 기다리던 것은 강조 없이 두고, 다음 문서에서 다시 띄운다.
  w.onerror = () => {
    for (const done of waiting.values()) done(null)
    waiting.clear()
    w.terminate()
    worker = undefined
  }
  return (worker = w)
}

function highlight(body: CodeBody): Promise<string | null> {
  return new Promise((resolve) => {
    waiting.set(body.id, resolve)
    highlighter().postMessage({
      id: body.id,
      code: body.code,
      name: body.name
    } satisfies HighlightRequest)
  })
}
