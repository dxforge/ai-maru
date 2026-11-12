export type CanvasMarkdown = { id: string; kind: 'markdown'; text: string; title?: string }

export type CanvasImage = {
  id: string
  kind: 'image'
  name: string
  mime: string
  bytes: Uint8Array
}

/** 읽기 전용 코드 뷰. `line` 이 있으면 그 줄(1부터)로 스크롤해 강조한다. `name` 은 파일 이름으로, 강조할 언어를 고를 때도 쓴다. */
export type CanvasCode = { id: string; kind: 'code'; name: string; text: string; line?: number }

export type CanvasDoc = CanvasMarkdown | CanvasImage | CanvasCode

/** 문서를 보낸 pty 와, main 이 문서를 창에 넘길 때 그 pty 가 있던 cell 의 id 다. main 이 cell 을 찾지 못하면 `cell` 이 없다. */
export type CanvasOwner = { pty?: string; cell?: string }

export type CanvasItem = CanvasDoc & CanvasOwner
