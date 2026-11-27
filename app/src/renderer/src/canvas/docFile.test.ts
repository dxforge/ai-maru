import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CanvasCode, CanvasDoc, CanvasMarkdown } from '../../../shared/canvas'
import { docSource, fileSafe, saveName } from './docFile'

const md = (doc: Partial<CanvasMarkdown> = {}): CanvasMarkdown => ({
  id: 'doc-1',
  kind: 'markdown',
  text: '# Hi\n',
  ...doc
})
const code = (doc: Partial<CanvasCode> = {}): CanvasCode => ({
  id: 'c',
  kind: 'code',
  name: 'run.sh',
  text: 'echo\r\n',
  ...doc
})
const image = (doc: Partial<CanvasDoc> = {}): CanvasDoc =>
  ({
    id: 'i',
    kind: 'image',
    name: 'shot.png',
    mime: 'image/png',
    bytes: new Uint8Array([1]),
    ...doc
  }) as CanvasDoc

describe('saveName', () => {
  it('파일에서 온 문서는 그 파일 이름이다', () => {
    expect(saveName(md({ path: '/Users/me/notes/plan.markdown', title: 'X' }), 'H')).toBe(
      'plan.markdown'
    )
    expect(saveName(code({ path: '/Users/me/a/b.ts', name: 'b.ts' }))).toBe('b.ts')
    expect(saveName(image({ path: '/Users/me/a/pic.JPEG', name: 'pic.JPEG' }))).toBe('pic.JPEG')
  })

  it('마크다운은 제목, 없으면 첫 제목, 그것도 없으면 id 에 .md 를 붙인다', () => {
    expect(saveName(md({ title: '설계 메모' }), 'Heading')).toBe('설계 메모.md')
    expect(saveName(md(), 'Heading')).toBe('Heading.md')
    expect(saveName(md({ title: '' }), '')).toBe('doc-1.md')
  })

  it('이미 확장자가 붙은 제목에는 다시 붙이지 않는다', () => {
    expect(saveName(md({ title: 'README.MD' }))).toBe('README.MD')
    expect(saveName(code({ title: 'run.sh' }))).toBe('run.sh')
  })

  it('코드는 제목, 없으면 name 이고 확장자는 name 의 것이다', () => {
    expect(saveName(code())).toBe('run.sh')
    expect(saveName(code({ title: 'build script' }))).toBe('build script.sh')
    expect(saveName(code({ name: 'Makefile' }))).toBe('Makefile')
  })

  it('붙인 이미지는 Pasted image.png 이고, name 에 확장자가 없으면 mime 에서 고른다', () => {
    expect(saveName(image({ id: 'clipboard:1', name: 'Pasted image' }))).toBe('Pasted image.png')
    expect(saveName(image({ name: 'photo', mime: 'image/jpeg' }))).toBe('photo.jpg')
    expect(saveName(image({ name: 'vector', mime: 'image/svg+xml' }))).toBe('vector.svg')
  })

  it('파일 이름에 쓸 수 없는 글자를 바꾸고, 다 지워지면 id 를 쓴다', () => {
    expect(saveName(md({ title: 'a/b: c' }))).toBe('a-b- c.md')
    expect(saveName(md({ id: 'clipboard:1', title: '   ' }))).toBe('clipboard-1.md')
  })

  it('제목이 `.`·`..` 뿐이면 id 를 쓰고, `.` 으로 시작하는 이름은 그대로 둔다', () => {
    expect(saveName(code({ id: 'c', name: 'Makefile', title: '..' }))).toBe('c')
    expect(saveName(code({ id: 'c', name: 'Makefile', title: '.' }))).toBe('c')
    expect(saveName(code({ name: '.zshrc' }))).toBe('.zshrc')
  })
})

describe('fileSafe', () => {
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

  it('80 글자에서 자를 때 글자 하나를 이루는 코드 포인트를 나누지 않는다', () => {
    expect(fileSafe('a'.repeat(79) + '👨‍👩‍👧')).toBe('a'.repeat(79) + '👨‍👩‍👧')
    expect(fileSafe('a'.repeat(80) + '👨‍👩‍👧')).toBe('a'.repeat(80))
  })

  it('구분자·제어 문자가 없고, 앞뒤 공백이 없으며, `.`·`..` 이 아니고, 80 글자를 넘지 않는다', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 200 }), (s) => {
        const safe = fileSafe(s)
        expect(safe).not.toMatch(/[/\\:\p{Cc}]/u)
        expect(safe).toBe(safe.trim())
        expect(safe).not.toMatch(/^\.+$/)
        expect([...segments.segment(safe)].length).toBeLessThanOrEqual(80)
      })
    )
  })

  it('두 번 고쳐도 한 번 고친 것과 같다', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 200 }), (s) => {
        expect(fileSafe(fileSafe(s))).toBe(fileSafe(s))
      })
    )
  })
})

describe('docSource', () => {
  it('마크다운은 원문 그대로이고 HTML 도 싣는다', () => {
    expect(docSource(md({ text: '# A\r\n' }), 'A')).toEqual({
      name: 'A.md',
      text: '# A\r\n',
      rich: true
    })
  })

  it('mermaid 파일은 펜스를 벗긴 원문이고 HTML 은 싣지 않는다', () => {
    const doc = md({ path: '/Users/me/flow.mmd', text: '```mermaid\ngraph LR\n```\n' })
    expect(docSource(doc)).toEqual({ name: 'flow.mmd', text: 'graph LR\n', rich: false })
  })

  it('파일에서 온 마크다운의 mermaid 블록은 벗기지 않는다', () => {
    const doc = md({ path: '/Users/me/flow.md', text: '```mermaid\ngraph LR\n```\n' })
    expect(docSource(doc)).toMatchObject({ text: '```mermaid\ngraph LR\n```\n', rich: true })
  })

  it('코드는 줄바꿈을 손보지 않은 원문이고 HTML 은 싣지 않는다', () => {
    expect(docSource(code())).toEqual({ name: 'run.sh', text: 'echo\r\n', rich: false })
  })
})
