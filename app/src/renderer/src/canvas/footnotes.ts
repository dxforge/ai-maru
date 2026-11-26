import { escapeText } from 'entities'
import { Lexer, type MarkedExtension, type Token, type Tokens } from 'marked'

// GFM 각주를 cmark-gfm 과 같은 규칙으로 읽는다. 확장은 참조·정의 토큰만 만들고, 번호를 매기고 정의를 문서 끝 목록으로
// 모으는 것은 lexing 이 끝난 뒤 `collectFootnotes` 가 토큰에 적는다. 그래서 묶음을 따로, 늦게 렌더해도 번호가 맞는다.
// 번호 매기기는 문서 사이에 상태를 남기지 않는다. 남는 것은 문서마다 id 접두사를 내는 `nextPrefix` 의 카운터뿐이다.

type Ref = Tokens.Generic & {
  type: 'footnoteRef'
  label: string
  /** 정의가 있는 참조에만 `collectFootnotes` 가 단다. */
  prefix?: string
  number?: number
  /** 같은 각주의 몇 번째 참조인지(1부터). */
  nth?: number
}
type Def = Tokens.Generic & { type: 'footnoteDef'; label: string; tokens: Token[] }
type Note = { number: number; refs: number; tokens: Token[] }
type List = Tokens.Generic & { type: 'footnotes'; prefix: string; notes: Note[] }

// cmark-gfm 의 정의 시작과 같다.
const DEF_START = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*/
const DEF_LINE = /\n {0,3}\[\^[^\]\s]+\]:/
const INDENTED = /(?:[ \t]*\n)*(?: {4}|\t)[^\n]*(?:\n|$)/y
const PARAGRAPH = Lexer.rules.block.gfm.paragraph
// 문단의 둘째 글자부터 그 문단 끝까지. marked 는 `start` 에 문단의 둘째 글자부터 넘긴다.
const PARAGRAPH_REST = new RegExp(PARAGRAPH.source.replace('^([^\\n]+', '^([^\\n]*'))

function untilDef(s: string): string {
  const cut = s.search(DEF_LINE)
  return cut === -1 ? s : s.slice(0, cut + 1)
}

let documents = 0
/** 한 창에 같이 붙는 문서마다 다른 각주 id 접두사. 호출하는 쪽은 lex 하는 문서마다 하나씩 받는다. */
export const nextPrefix = (): string => `md${++documents}-`
const ID = /^md\d+-fn(?:ref)?-\d+(?:-\d+)?$/
export const isFootnoteId = (id: string): boolean => ID.test(id)
const noteId = (prefix: string, number: number): string => `${prefix}fn-${number}`
const refId = (prefix: string, number: number, nth: number): string =>
  `${prefix}fnref-${number}${nth > 1 ? `-${nth}` : ''}`

const BACK_TITLE = '본문으로 돌아가기'

export const footnotes: MarkedExtension = {
  extensions: [
    {
      name: 'footnoteDef',
      level: 'block',
      // 정의는 앞 문단을 빈 줄 없이 끊는다(cmark-gfm 과 같다). marked 는 문단마다 `start` 가 돌려준 자리에서 문단을
      // 끊는데, 남은 원문 끝까지 찾으면 큰 문서의 lex 시간이 문서 크기의 제곱으로 늘어나므로 그 문단 안만 본다.
      start(src) {
        const cut = PARAGRAPH_REST.exec(src)![0].search(DEF_LINE)
        return cut === -1 ? undefined : cut + 1
      },
      tokenizer(src) {
        const m = DEF_START.exec(src)
        if (!m) return undefined
        let pos = m[0].length
        const lines: string[] = []
        const first = PARAGRAPH.exec(src.slice(pos))
        if (first) {
          const raw = untilDef(first[0])
          lines.push(raw.replace(/\n$/, ''))
          pos += raw.length
        } else {
          lines.push('')
          if (src[pos] === '\n') pos++
        }
        for (;;) {
          INDENTED.lastIndex = pos
          const more = INDENTED.exec(src)
          if (!more) break
          for (const line of more[0].replace(/\n$/, '').split('\n'))
            lines.push(line.replace(/^(?: {1,4}|\t)/, ''))
          pos += more[0].length
        }
        const def: Def = {
          type: 'footnoteDef',
          raw: src.slice(0, pos),
          label: m[1]!,
          tokens: this.lexer.blockTokens(lines.join('\n'), [])
        }
        return def
      },
      renderer: () => ''
    },
    {
      name: 'footnoteRef',
      level: 'inline',
      tokenizer(src) {
        const m = /^\[\^([^\]\s]+)\](?!\()/.exec(src)
        if (!m) return undefined
        const ref: Ref = { type: 'footnoteRef', raw: m[0], label: m[1]! }
        return ref
      },
      renderer(token) {
        const { raw, prefix, number, nth } = token as Ref
        if (number === undefined) return escapeText(raw)
        return `<sup><a id="${refId(prefix!, number, nth!)}" href="#${noteId(prefix!, number)}">${number}</a></sup>`
      }
    },
    {
      name: 'footnotes',
      renderer(token) {
        const { prefix, notes } = token as List
        const items = notes.map(({ number, refs, tokens }) => {
          const back = Array.from({ length: refs }, (_, i) => {
            const n = i + 1
            const sup = n > 1 ? `<sup>${n}</sup>` : ''
            return `<a href="#${refId(prefix, number, n)}" title="${BACK_TITLE}">↩︎${sup}</a>`
          }).join(' ')
          const body = this.parser.parse(tokens)
          const html =
            tokens.at(-1)?.type === 'paragraph'
              ? body.replace(/<\/p>\n?$/, ` ${back}</p>\n`)
              : `${body}<p>${back}</p>\n`
          return `<li id="${noteId(prefix, number)}">\n${html}</li>\n`
        })
        return `<hr>\n<ol class="footnotes">\n${items.join('')}</ol>\n`
      }
    }
  ]
}

function children(t: Token): Token[][] {
  if (t.type === 'list') return [(t as Tokens.List).items]
  if (t.type === 'table') {
    const { header, rows } = t as Tokens.Table
    return [...header, ...rows.flat()].map((c) => c.tokens)
  }
  // 이미지의 alt 는 글자로만 그려지므로 그 안의 참조는 각주가 아니다.
  if (t.type === 'image') return []
  return 'tokens' in t && t.tokens ? [t.tokens] : []
}

// 문서 순서로 참조와 정의를 `seq` 에 모으고, 정의는 원래 자리에서 뺀다. 정의 안은 따로 걸어 `inner` 에 둔다. 그 정의가
// 목록에 실릴지는 문서를 다 걸은 뒤에야 알기 때문이다.
function walk(
  tokens: Token[],
  seq: (Ref | Def)[],
  defs: Map<string, Def>,
  inner: Map<Def, (Ref | Def)[]>
): void {
  let kept = 0
  for (const t of tokens) {
    if (t.type === 'footnoteDef') {
      const def = t as Def
      const key = def.label.toLowerCase()
      if (defs.has(key)) continue
      defs.set(key, def)
      seq.push(def)
      const items: (Ref | Def)[] = []
      inner.set(def, items)
      walk(def.tokens, items, defs, inner)
      continue
    }
    if (t.type === 'footnoteRef') seq.push(t as Ref)
    for (const c of children(t)) walk(c, seq, defs, inner)
    tokens[kept++] = t
  }
  tokens.length = kept
}

/**
 * lexing 한 문서에서 각주에 번호를 매긴다. 번호는 첫 참조 순서이고, 정의 안의 참조는 그 정의가 있던 자리에서 센다.
 * 라벨은 대소문자를 가리지 않고 맞추고, 같은 라벨의 정의가 여럿이면 처음 것을 쓴다. 정의는 원래 자리에서 빼고,
 * 본문이나 목록에 실린 정의에서 참조된 것만 번호 차례로 `tokens` 끝의 목록 토큰에 담는다. 정의 없는 참조는 글자 그대로
 * 남는다. `prefix` 는 각주 id 의 접두사로, 한 창에 같이 붙는 문서마다 달라야 한다.
 */
export function collectFootnotes(tokens: Token[], prefix: string): void {
  const seq: (Ref | Def)[] = []
  const defs = new Map<string, Def>()
  const inner = new Map<Def, (Ref | Def)[]>()
  walk(tokens, seq, defs, inner)
  const find = (ref: Ref): Def | undefined => defs.get(ref.label.toLowerCase())

  const shown = new Set<Def>()
  const show = (items: (Ref | Def)[]): void => {
    for (const it of items) {
      const def = it.type === 'footnoteRef' ? find(it as Ref) : undefined
      if (def && !shown.has(def)) {
        shown.add(def)
        show(inner.get(def)!)
      }
    }
  }
  show(seq)

  const notes = new Map<Def, Note>()
  const number = (items: (Ref | Def)[]): void => {
    for (const it of items) {
      if (it.type === 'footnoteDef') {
        if (shown.has(it as Def)) number(inner.get(it as Def)!)
        continue
      }
      const ref = it as Ref
      const def = find(ref)
      if (!def) continue
      let note = notes.get(def)
      if (!note) notes.set(def, (note = { number: notes.size + 1, refs: 0, tokens: def.tokens }))
      ref.prefix = prefix
      ref.number = note.number
      ref.nth = ++note.refs
    }
  }
  number(seq)
  if (!notes.size) return
  const list: List = { type: 'footnotes', raw: '', prefix, notes: [...notes.values()] }
  tokens.push(list)
}
