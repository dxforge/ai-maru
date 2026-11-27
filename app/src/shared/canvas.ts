/**
 * 세 문서가 함께 갖는 필드. `title` 은 Canvas 목록에 보이는 제목으로, 없으면 마크다운은 첫 제목(제목이 없으면 `path` 의
 * 파일 이름), 코드·이미지는 `name` 이 보인다. `path` 는 문서를 읽은 파일의 절대경로다. 파일에서 오지 않은 문서(`text` 로
 * 넣은 마크다운, 클립보드에서 붙인 이미지)에는 `path` 가 없다.
 */
type CanvasDocBase = { id: string; title?: string; path?: string }

export type CanvasMarkdown = CanvasDocBase & { kind: 'markdown'; text: string }

export type CanvasImage = CanvasDocBase & {
  kind: 'image'
  name: string
  mime: string
  bytes: Uint8Array
}

/** 읽기 전용 코드 뷰. `line` 이 있으면 그 줄(1부터)로 스크롤해 강조한다. `name` 은 파일 이름으로, 강조할 언어를 고를 때도 쓴다. */
export type CanvasCode = CanvasDocBase & { kind: 'code'; name: string; text: string; line?: number }

export type CanvasDoc = CanvasMarkdown | CanvasImage | CanvasCode

/** 문서를 보낸 pty 와, main 이 문서를 창에 넘길 때 그 pty 가 있던 cell 의 id 다. main 이 cell 을 찾지 못하면 `cell` 이 없다. */
export type CanvasOwner = { pty?: string; cell?: string }

export type CanvasItem = CanvasDoc & CanvasOwner

const MERMAID_EXTS = ['.mmd', '.mermaid']

/** `.mmd`·`.mermaid` 파일은 main 이 `mermaidDoc` 으로 감싼 마크다운 문서로 보낸다. */
export const isMermaidPath = (path: string): boolean =>
  MERMAID_EXTS.some((ext) => path.toLowerCase().endsWith(ext))

/**
 * mermaid 파일의 원문을 그 원문 하나만 든 mermaid 코드 블록으로 감싼다. 펜스는 원문에서 가장 길게 이어진 backtick 보다
 * 한 개 길게(최소 3개) 써서, 원문 안에서 블록이 닫히지 않게 한다.
 */
export function mermaidDoc(source: string): string {
  const longest = (source.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const body = source.endsWith('\n') ? source : `${source}\n`
  return `${fence}mermaid\n${body}${fence}\n`
}

/**
 * `mermaidDoc` 이 감싼 문서에서 원문을 꺼낸다. 끝 줄바꿈이 없던 원문에는 `mermaidDoc` 이 붙인 줄바꿈이 남는다. 그 모양이
 * 아니면 받은 그대로 돌려준다.
 */
export function mermaidSource(doc: string): string {
  const m = /^(`{3,})mermaid\n([\s\S]*)\1\n$/.exec(doc)
  return m ? m[2]! : doc
}

/** Canvas 가 이미지 문서로 여는 파일의 확장자와 그 MIME 타입. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}
