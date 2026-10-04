export type CanvasMarkdown = { id: string; kind: 'markdown'; text: string; title?: string }

export type CanvasDoc = CanvasMarkdown | { id: string; kind: 'image'; path: string }

export type CanvasItem =
  CanvasMarkdown | { id: string; kind: 'image'; name: string; mime: string; bytes: Uint8Array }
