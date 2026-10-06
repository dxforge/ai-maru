import { resolveObjectURL } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import type { CanvasItem } from '../../../shared/canvas'
import { createCanvas } from './store'

const md = (id: string, text: string, title?: string): CanvasItem => ({
  id,
  kind: 'markdown',
  text,
  title
})

const image = (id: string, name: string): CanvasItem => ({
  id,
  kind: 'image',
  name,
  mime: 'image/png',
  bytes: new Uint8Array([1])
})

function titleOf(item: CanvasItem): string {
  const c = createCanvas()
  c.put(item)
  return c.docs.value[0].title
}

describe('createCanvas', () => {
  it('처음엔 문서도 없고 패널도 닫혀 있다', () => {
    const c = createCanvas()
    expect(c.docs.value).toEqual([])
    expect(c.open.value).toBe(false)
    expect(c.selected.value).toBeNull()
  })

  it('새 문서는 목록 맨 위에 들어가고, 패널이 열리며 그 문서가 선택된다', () => {
    const c = createCanvas()
    c.put(md('a', 'A'))
    c.put(md('b', 'B'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['b', 'a'])
    expect(c.selected.value?.id).toBe('b')
    expect(c.open.value).toBe(true)
  })

  it('같은 id 가 다시 오면 자리를 지킨 채 내용만 바뀌고 그 문서가 선택된다', () => {
    const c = createCanvas()
    c.put(md('a', 'A'))
    c.put(md('b', 'B'))
    c.put(md('a', 'A2'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['b', 'a'])
    expect(c.selected.value).toMatchObject({ id: 'a', text: 'A2' })
  })

  it('같은 id 의 이미지가 다시 오면 앞 그림의 URL 을 놓는다', () => {
    const c = createCanvas()
    c.put(image('i', 'a.png'))
    const first = (c.selected.value as { url: string }).url
    c.put(image('i', 'a.png'))
    expect(resolveObjectURL(first)).toBeUndefined()
    expect(resolveObjectURL((c.selected.value as { url: string }).url)).toBeDefined()
  })

  it('같은 id 로 이미지 대신 마크다운이 오면 그림의 URL 을 놓는다', () => {
    const c = createCanvas()
    c.put(image('i', 'a.png'))
    const url = (c.selected.value as { url: string }).url
    c.put(md('i', 'text'))
    expect(resolveObjectURL(url)).toBeUndefined()
    expect(c.selected.value).toMatchObject({ kind: 'markdown', text: 'text' })
  })

  it('닫은 뒤 문서가 오면 다시 열린다', () => {
    const c = createCanvas()
    c.put(md('a', 'A'))
    c.close()
    expect(c.open.value).toBe(false)
    c.put(md('a', 'A2'))
    expect(c.open.value).toBe(true)
  })

  it('닫은 패널을 다시 열면 고른 문서가 그대로다', () => {
    const c = createCanvas()
    c.put(md('a', 'A'))
    c.put(md('b', 'B'))
    c.select('a')
    c.close()
    c.reopen()
    expect(c.open.value).toBe(true)
    expect(c.selected.value?.id).toBe('a')
  })

  it('toggle 은 열린 패널을 닫고 닫힌 패널을 연다 — 문서가 없어도 연다', () => {
    const c = createCanvas()
    c.toggle()
    expect(c.open.value).toBe(true)
    c.toggle()
    expect(c.open.value).toBe(false)
    c.put(md('a', 'A'))
    c.toggle()
    expect(c.open.value).toBe(false)
    c.toggle()
    expect(c.selected.value?.id).toBe('a')
    expect(c.open.value).toBe(true)
  })
})

describe('문서 제목', () => {
  it('준 제목이 먼저다', () => {
    expect(titleOf(md('a', '# 머리', '제목'))).toBe('제목')
  })

  it('제목이 없으면 첫 heading 이다', () => {
    expect(titleOf(md('a', '본문\n\n## 둘째\n\n# 셋째'))).toBe('둘째')
  })

  it('heading 안의 인라인 마크다운은 글자만 남긴다', () => {
    expect(titleOf(md('a', '# **굵게** `code` [링크](https://x) <em>e</em>'))).toBe(
      '굵게 code 링크 e'
    )
  })

  it('heading 의 문자 참조는 본문처럼 풀고, 코드 안의 것은 글자 그대로 둔다', () => {
    expect(
      titleOf(md('a', '# Tom &amp; *J &lt;3&gt;* [&copy;](https://x) &#38; `&amp;` \\&amp;'))
    ).toBe('Tom & J <3> © & &amp; &amp;')
  })

  it('세미콜론 없는 참조는 본문처럼 풀지 않고, 세미콜론까지의 이름은 본문처럼 앞부분을 푼다', () => {
    expect(titleOf(md('a', '# &copy 2024 a &lt b &copyx; &notit;'))).toBe(
      '&copy 2024 a &lt b ©x; ¬it;'
    )
  })

  it('밑줄 heading 도 heading 이다', () => {
    expect(titleOf(md('a', '머리\n===\n'))).toBe('머리')
  })

  it('코드 블록 안의 # 줄은 heading 이 아니다', () => {
    expect(titleOf(md('a', '```sh\n# 주석\n```\n'))).toBe('Markdown')
  })

  it('heading 이 없으면 Markdown 이다', () => {
    expect(titleOf(md('a', '본문만'))).toBe('Markdown')
  })

  it('이미지는 파일 이름이다', () => {
    expect(titleOf(image('i', 'shot.png'))).toBe('shot.png')
  })
})
