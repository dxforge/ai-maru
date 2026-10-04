import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { CanvasDoc, CanvasItem } from '../shared/canvas'

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

/** 같은 id 의 문서가 있으면 그 문서를 바꾼다. */
export async function putCanvas(win: BrowserWindow, doc: CanvasDoc): Promise<void> {
  win.webContents.send('canvas:put', await toItem(doc))
}

async function toItem(doc: CanvasDoc): Promise<CanvasItem> {
  if (doc.kind === 'markdown') return doc
  const mime = IMAGE_TYPES[extname(doc.path).toLowerCase()]
  if (!mime) throw new Error(`이미지 파일이 아니다: ${doc.path}`)
  return {
    id: doc.id,
    kind: 'image',
    name: basename(doc.path),
    mime,
    bytes: await readFile(doc.path)
  }
}
