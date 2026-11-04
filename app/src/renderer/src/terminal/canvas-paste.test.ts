import { describe, expect, it } from 'vitest'
import { hasImage, isImagePasteKey } from './canvas-paste'

describe('hasImage', () => {
  it('image/* 형식이 있으면 true', () => {
    expect(hasImage(['Files', 'image/png'])).toBe(true)
  })

  it('글자·파일만 있으면 false', () => {
    expect(hasImage(['text/plain', 'Files'])).toBe(false)
    expect(hasImage([])).toBe(false)
  })
})

const key = (over: Partial<Parameters<typeof isImagePasteKey>[0]>) => ({
  type: 'keydown',
  key: 'v',
  code: 'KeyV',
  ctrlKey: true,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...over
})

describe('isImagePasteKey', () => {
  it('⌃V 의 keydown 이면 true', () => {
    expect(isImagePasteKey(key({}))).toBe(true)
  })

  it('한글 자판의 ⌃V 는 자판 위치로 맞춘다', () => {
    expect(isImagePasteKey(key({ key: 'ㅍ' }))).toBe(true)
  })

  it('라틴 글자 자판에서는 글자로 맞춘다', () => {
    // Dvorak 의 KeyV 자리는 k 다.
    expect(isImagePasteKey(key({ key: 'k' }))).toBe(false)
    expect(isImagePasteKey(key({ key: 'v', code: 'Period' }))).toBe(true)
  })

  it('⌘V·keyup·다른 modifier 를 함께 쥔 것은 false', () => {
    expect(isImagePasteKey(key({ ctrlKey: false, metaKey: true }))).toBe(false)
    expect(isImagePasteKey(key({ type: 'keyup' }))).toBe(false)
    expect(isImagePasteKey(key({ metaKey: true }))).toBe(false)
    expect(isImagePasteKey(key({ shiftKey: true }))).toBe(false)
    expect(isImagePasteKey(key({ altKey: true }))).toBe(false)
  })
})
