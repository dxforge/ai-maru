import { describe, expect, it } from 'vitest'
import { createToasts, type Toast } from './store'

const A: Toast = { level: 'error', title: 'A', lines: ['a'] }
const B: Toast = { level: 'warning', title: 'B', lines: ['b'], detail: 'b.toml' }

describe('createToasts', () => {
  it('put 한 토스트가 목록에 있다', () => {
    const t = createToasts()
    t.put('a', A)
    expect(t.list.value).toEqual([{ id: 'a', ...A }])
  })

  it('같은 id 로 다시 put 하면 자리를 지키고 내용만 바뀐다', () => {
    const t = createToasts()
    t.put('a', A)
    t.put('b', B)
    t.put('a', { ...A, title: 'A2' })
    expect(t.list.value.map((x) => [x.id, x.title])).toEqual([
      ['a', 'A2'],
      ['b', 'B']
    ])
  })

  it('close 하면 빠지고, 그 뒤 같은 id 로 put 하면 다시 들어간다', () => {
    const t = createToasts()
    t.put('a', A)
    t.close('a')
    expect(t.list.value).toEqual([])
    t.put('a', A)
    expect(t.list.value).toEqual([{ id: 'a', ...A }])
  })

  it('없는 id 를 close 해도 아무것도 바뀌지 않는다', () => {
    const t = createToasts()
    t.put('a', A)
    t.close('b')
    expect(t.list.value.map((x) => x.id)).toEqual(['a'])
  })
})
