import { IMAGE_TYPES, isMermaidPath, mermaidSource, type CanvasDoc } from '../../../shared/canvas'

/**
 * 문서를 복사·저장할 때 쓰는 원문. `text` 는 main 이 보낸 글자 그대로이고, mermaid 파일은 펜스를 벗긴 파일 원문이다.
 * `rich` 이면 복사할 때 그린 HTML 도 함께 싣는다. 이미지는 원본 바이트를 담은 `blob` 이다. `name` 은 저장 대화상자의 기본
 * 이름이다.
 */
export type DocSource = { name: string } & ({ text: string; rich: boolean } | { blob: Blob })

/** `heading` 은 마크다운 문서의 첫 제목이다. 이미지는 `blob` 을 받는다. */
export function docSource(doc: CanvasDoc, heading?: string, blob?: Blob): DocSource {
  const name = saveName(doc, heading)
  if (doc.kind === 'image') return { name, blob: blob ?? new Blob([doc.bytes as BlobPart]) }
  if (doc.kind === 'code') return { name, text: doc.text, rich: false }
  if (doc.path && isMermaidPath(doc.path))
    return { name, text: mermaidSource(doc.text), rich: false }
  return { name, text: doc.text, rich: true }
}

const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

const IMAGE_EXTS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(IMAGE_TYPES)
    .reverse()
    .map(([ext, mime]) => [mime, ext])
)

/**
 * 저장 대화상자의 기본 이름. 파일에서 온 문서는 그 파일 이름이다. 아니면 제목(마크다운은 첫 제목, 코드·이미지는
 * `name`, 그것도 없으면 id)을 파일 이름에 쓸 수 있게 고치고, 이미 붙어 있지 않으면 확장자를 붙인다. 확장자는 마크다운이
 * `.md`, 코드는 `name` 의 것, 이미지는 `name` 의 것이고 없으면 `mime` 에서 고른다.
 */
export function saveName(doc: CanvasDoc, heading?: string): string {
  if (doc.path) return doc.path.slice(doc.path.lastIndexOf('/') + 1)
  const title = doc.kind === 'markdown' ? doc.title || heading : doc.title || doc.name
  const ext =
    doc.kind === 'markdown'
      ? '.md'
      : extOf(doc.name) || (doc.kind === 'image' ? (IMAGE_EXTS[doc.mime] ?? '') : '')
  const base = fileSafe(title ?? '') || fileSafe(doc.id) || 'Untitled'
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext
}

// macOS 의 파일 이름 한도는 255 바이트다. 한글 한 글자가 UTF-8 로 3 바이트라 80 글자면 확장자를 붙여도 넘지 않는다.
const NAME_CHARS = 80

/** 경로 구분자·`:`·제어 문자를 `-` 로 바꾸고, 공백을 하나로 줄여 앞뒤를 자른 뒤 80 글자로 줄인다. */
export function fileSafe(s: string): string {
  const safe = s
    .replace(/[/\\:\p{Cc}]/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(safe).slice(0, NAME_CHARS).join('').trimEnd()
}
