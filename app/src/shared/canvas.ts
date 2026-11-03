export type CanvasMarkdown = { id: string; kind: 'markdown'; text: string; title?: string }

export type CanvasDoc = CanvasMarkdown | { id: string; kind: 'image'; path: string }

/** 문서를 보낸 pty 와, main 이 문서를 창에 넘길 때 그 pty 가 있던 cell 의 id 다. main 이 cell 을 찾지 못하면 `cell` 이 없다. */
export type CanvasOwner = { pty?: string; cell?: string }

export type CanvasItem = (
  CanvasMarkdown | { id: string; kind: 'image'; name: string; mime: string; bytes: Uint8Array }
) &
  CanvasOwner
