import { IMAGE_TYPES, isMermaidPath, mermaidSource, type CanvasDoc } from '../../../shared/canvas'

/**
 * 문서를 복사·저장할 때 쓰는 원문. `text` 는 main 이 보낸 글자 그대로이고, mermaid 파일은 펜스를 벗긴 파일 원문이다.
 * `rich` 이면 복사할 때 그린 HTML 도 함께 싣는다. 이미지는 원본 바이트를 담은 `blob` 이다. `name` 은 저장 대화상자의 기본
 * 이름이다.
 */
export type DocSource = { name: string } & ({ text: string; rich: boolean } | { blob: Blob })

export function docSource(doc: Exclude<CanvasDoc, { kind: 'image' }>, heading?: string): DocSource {
  const name = saveName(doc, heading)
  if (doc.kind === 'code') return { name, text: doc.text, rich: false }
  if (doc.path && isMermaidPath(doc.path))
    return { name, text: mermaidSource(doc.text), rich: false }
  return { name, text: doc.text, rich: true }
}

export const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

const IMAGE_EXTS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(IMAGE_TYPES)
    .reverse()
    .map(([ext, mime]) => [mime, ext])
)

export function saveName(doc: CanvasDoc, heading?: string): string {
  if (doc.path) return fileName(doc.path)
  const title = doc.kind === 'markdown' ? doc.title || heading : doc.title || doc.name
  const ext =
    doc.kind === 'markdown'
      ? '.md'
      : extOf(doc.name) || (doc.kind === 'image' ? (IMAGE_EXTS[doc.mime] ?? '') : '')
  const base = fileSafe(title ?? '') || fileSafe(doc.id) || 'Untitled'
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext
}

// macOS 의 파일 이름 한도는 255 바이트다. 한글처럼 UTF-8 로 3 바이트인 글자는 80 글자가 240 바이트라 확장자를 붙여도
// 넘지 않는다. 4 바이트 글자(이모지 등)가 많으면 넘을 수 있다.
const NAME_CHARS = 80

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function fileSafe(s: string): string {
  const safe = s
    .replace(/[/\\:\p{Cc}]/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const cut = Array.from(graphemes.segment(safe), (g) => g.segment)
    .slice(0, NAME_CHARS)
    .join('')
    .trimEnd()
  // `.`·`..` 은 파일 이름이 아니라 디렉토리를 가리킨다.
  return /^\.+$/.test(cut) ? '' : cut
}
