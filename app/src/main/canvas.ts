import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { CanvasDoc, CanvasItem, CanvasMarkdown, CanvasOwner } from '../shared/canvas'
import { InvalidParams } from './cli-server'
import { WINDOW_WAIT_MS, type WindowReady } from './window-ready'

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

export type CellOf = (pty: string) => string | undefined

export function ownerOf(pty: string, cellOf: CellOf): () => CanvasOwner {
  return () => {
    const cell = cellOf(pty)
    return cell === undefined ? { pty } : { pty, cell }
  }
}

/**
 * `owner` 는 창이 준비된 뒤 문서를 보낼 때 부른다. 재시작 직후에는 renderer 가 pane 의 pty 를 다시 열어야 main 이
 * 그 pty 의 cell 을 알기 때문이다.
 */
export async function putCanvas(
  window: () => BrowserWindow | undefined,
  windowReady: WindowReady,
  doc: CanvasDoc,
  owner: () => CanvasOwner
): Promise<void> {
  const item = await toItem(doc)
  let unqueue = (): void => {}
  let timer: NodeJS.Timeout | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`the window was not ready within ${WINDOW_WAIT_MS / 1000}s`)),
        WINDOW_WAIT_MS
      )
      unqueue = windowReady.whenReady(() => {
        const win = window()
        if (!win || win.isDestroyed()) return reject(new Error('no window to show the document in'))
        try {
          win.webContents.send('canvas:put', { ...item, ...owner() })
          resolve()
        } catch (e) {
          reject(e)
        }
      })
    })
  } finally {
    clearTimeout(timer)
    unqueue()
  }
}

// 계약은 core/crates/maru 의 모듈 doc 에 있다.
export function canvasPut(
  window: () => BrowserWindow | undefined,
  windowReady: WindowReady,
  cellOf: CellOf
) {
  return async (params: Record<string, unknown>, pty: string): Promise<{ id: string }> => {
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
    await putCanvas(window, windowReady, doc, ownerOf(pty, cellOf))
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
