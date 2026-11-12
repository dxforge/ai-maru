import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { CanvasDoc, CanvasImage, CanvasMarkdown, CanvasOwner } from '../shared/canvas'
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

const imageType = (path: string): string | undefined => IMAGE_TYPES[extname(path).toLowerCase()]

/** 이미지 파일을 부른 때의 내용으로 읽는다. id 는 경로라, 같은 cell 에서 같은 파일을 다시 넣으면 그 문서를 바꾼다. */
async function imageFile(path: string, mime: string): Promise<CanvasImage> {
  return { id: path, kind: 'image', name: basename(path), mime, bytes: await readFile(path) }
}

export const CODE_MAX_BYTES = 5 * 1024 * 1024
// git 이 바이너리를 가를 때 보는 길이다(`buffer_is_binary` 의 FIRST_FEW_BYTES).
const BINARY_PROBE_BYTES = 8000

/** 앞 8000바이트에 NUL 이 없고 UTF-8 로 읽히면 그 글자. 깨진 글자를 보이지 않으려고 디코드 실패는 null 이다. */
export function codeText(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Canvas 가 그릴 수 있는 파일이면 그 문서. `.md`·이미지가 아니면 5 MiB 이하의 텍스트 파일을 코드 문서로 보고, `line` 을
 * 붙인다. id 는 경로라, 같은 cell 에서 같은 파일을 다시 열면 그 문서를 바꾼다.
 */
export async function canvasDocFor(path: string, line?: number): Promise<CanvasDoc | null> {
  if (extname(path).toLowerCase() === '.md') {
    return { id: path, kind: 'markdown', text: await readFile(path, 'utf8'), title: basename(path) }
  }
  const mime = imageType(path)
  if (mime) return imageFile(path, mime)
  if ((await stat(path)).size > CODE_MAX_BYTES) return null
  const text = codeText(await readFile(path))
  if (text === null) return null
  return { id: path, kind: 'code', name: basename(path), text, ...(line ? { line } : {}) }
}

/** Electron `clipboard.read()` 의 항목 가운데 쓰는 것. */
export type ClipboardEntry = {
  types: readonly string[]
  getType(type: 'image/png'): Promise<unknown>
}

// macOS 클립보드에 TIFF 만 있어도 Electron 은 `image/png` 로 바꿔 준다(Electron 45.1 에서 확인했다).
async function clipboardPng(
  read: () => Promise<readonly ClipboardEntry[]>
): Promise<Uint8Array | null> {
  const entry = (await read()).find((e) => e.types.includes('image/png'))
  const blob = await entry?.getType('image/png')
  return blob instanceof Blob ? Buffer.from(await blob.arrayBuffer()) : null
}

/** 터미널에 붙이거나 끌어다 놓은 이미지를 Canvas 에 넣는다. 터미널에 가는 내용은 renderer 가 따로 정한다. */
export function canvasPaste(
  window: () => BrowserWindow | undefined,
  windowReady: WindowReady,
  cellOf: CellOf,
  readClipboard: () => Promise<readonly ClipboardEntry[]>
) {
  const put = (doc: CanvasDoc, pty: string): Promise<void> =>
    putCanvas(window, windowReady, doc, ownerOf(pty, cellOf))
  return {
    /** 못 읽는 경로가 있어도 나머지 이미지는 넣는다. 못 넣은 것은 끝에 모아 throw 한다. */
    async files(pty: string, paths: readonly string[]): Promise<void> {
      const failed: unknown[] = []
      for (const path of paths) {
        const mime = imageType(path)
        if (!mime) continue
        await imageFile(path, mime)
          .then((doc) => put(doc, pty))
          .catch((e: unknown) => failed.push(e))
      }
      if (failed.length) throw new AggregateError(failed, 'some pasted images were not put')
    },
    async clipboard(pty: string): Promise<void> {
      const bytes = await clipboardPng(readClipboard)
      if (!bytes) return
      const id = `clipboard:${randomUUID()}`
      await put({ id, kind: 'image', name: 'Pasted image', mime: 'image/png', bytes }, pty)
    }
  }
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
          win.webContents.send('canvas:put', { ...doc, ...owner() })
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
