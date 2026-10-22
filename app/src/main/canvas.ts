import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { CanvasDoc, CanvasItem, CanvasMarkdown } from '../shared/canvas'
import { InvalidParams } from './cli-server'

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}

/** Canvas 가 그릴 수 있는 파일(`.md`·이미지)이면 그 문서. id 는 경로라 같은 파일은 같은 문서를 바꾼다. */
export async function canvasDocFor(path: string): Promise<CanvasDoc | null> {
  const ext = extname(path).toLowerCase()
  if (ext === '.md') {
    return { id: path, kind: 'markdown', text: await readFile(path, 'utf8'), title: basename(path) }
  }
  return ext in IMAGE_TYPES ? { id: path, kind: 'image', path } : null
}

export async function putCanvas(
  window: () => BrowserWindow | undefined,
  doc: CanvasDoc
): Promise<void> {
  const win = window()
  if (!win || win.isDestroyed()) throw new Error('no window to show the document in')
  win.webContents.send('canvas:put', await toItem(doc))
}

// 계약은 core/crates/maru 의 모듈 doc 에 있다.
export function canvasPut(window: () => BrowserWindow | undefined) {
  return async (params: Record<string, unknown>): Promise<{ id: string }> => {
    const { text, id, title } = params
    if (typeof text !== 'string') throw new InvalidParams('params.text must be a string')
    if (id !== undefined && (typeof id !== 'string' || id === '')) {
      throw new InvalidParams('params.id must be a non-empty string')
    }
    if (title !== undefined && typeof title !== 'string') {
      throw new InvalidParams('params.title must be a string')
    }
    const doc: CanvasMarkdown = {
      id: id ?? randomUUID(),
      kind: 'markdown',
      text,
      ...(title === undefined ? {} : { title })
    }
    await putCanvas(window, doc)
    return { id: doc.id }
  }
}

async function toItem(doc: CanvasDoc): Promise<CanvasItem> {
  if (doc.kind === 'markdown') return doc
  const mime = IMAGE_TYPES[extname(doc.path).toLowerCase()]
  if (!mime) throw new Error(`not an image file: ${doc.path}`)
  return {
    id: doc.id,
    kind: 'image',
    name: basename(doc.path),
    mime,
    bytes: await readFile(doc.path)
  }
}
