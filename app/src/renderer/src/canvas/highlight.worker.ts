import { highlightCode } from './highlight'

export type HighlightRequest = { id: number; code: string; name: string }
/** 모르는 언어이거나 강조하다 실패하면 `html` 이 null 이다. */
export type HighlightResponse = { id: number; html: string | null }

self.onmessage = async ({ data }: MessageEvent<HighlightRequest>) => {
  const html = await highlightCode(data.code, data.name).catch(() => null)
  self.postMessage({ id: data.id, html } satisfies HighlightResponse)
}
