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
