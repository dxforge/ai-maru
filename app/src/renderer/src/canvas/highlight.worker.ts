import { highlightCode } from './highlight'

export type HighlightRequest = { id: number; code: string; name: string }
export type HighlightResponse = { id: number; html: string | null }

self.onmessage = async ({ data }: MessageEvent<HighlightRequest>) => {
  const html = await highlightCode(data.code, data.name).catch(() => null)
  self.postMessage({ id: data.id, html } satisfies HighlightResponse)
}
