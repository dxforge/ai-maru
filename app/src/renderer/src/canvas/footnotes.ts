import { escapeText } from 'entities'
import { Lexer, type MarkedExtension, type Token, type Tokens } from 'marked'

// GFM 각주를 cmark-gfm 과 같은 규칙으로 읽는다. 확장은 참조·정의 토큰만 만들고, 번호를 매기고 정의를 문서 끝 목록으로
// 모으는 것은 lexing 이 끝난 뒤 `collectFootnotes` 가 토큰에 적는다. 그래야 묶음을 따로, 늦게 렌더해도 번호가 맞고
// 문서 사이에 남는 상태가 없다.

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

// cmark-gfm 의 정의 시작과 같다. 라벨에는 `]`·공백·탭·줄바꿈이 들어가지 않는다.
const DEF_START = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*/
const DEF_LINE = /\n {0,3}\[\^[^\]\s]+\]:/
// 정의의 첫 문단 뒤에 이어지는 줄: 빈 줄을 건너 4칸(또는 탭) 들여 쓴 줄.
const INDENTED = /(?:[ \t]*\n)*(?: {4}|\t)[^\n]*(?:\n|$)/y
const PARAGRAPH = Lexer.rules.block.gfm.paragraph

// 문단은 다음 정의 줄 앞에서 끊는다. 끊은 자리의 줄바꿈은 문단 쪽에 남긴다.
function untilDef(s: string): string {
  const cut = s.search(DEF_LINE)
  return cut === -1 ? s : s.slice(0, cut + 1)
}

let documents = 0
/** 한 창에 같이 붙는 문서마다 다른 각주 id 머리. lex 하는 문서마다 하나씩 받는다. */
export const nextPrefix = (): string => `md${++documents}-`
const ID = /^md\d+-fn(?:ref)?-\d+(?:-\d+)?$/
/** 각주 확장이 만든 id 인가. sanitize 와 문서 안 링크 처리가 이것으로 각주 링크를 가린다. */
export const isFootnoteId = (id: string): boolean => ID.test(id)
const noteId = (prefix: string, number: number): string => `${prefix}fn-${number}`
const refId = (prefix: string, number: number, nth: number): string =>
  `${prefix}fnref-${number}${nth > 1 ? `-${nth}` : ''}`

const BACK_TITLE = '본문으로 돌아가기'

export const footnotes: MarkedExtension = {
  // 정의는 앞 문단을 빈 줄 없이 끊는다(cmark-gfm 과 같다). marked 의 `startBlock` 은 문단마다 문서 끝까지 찾으므로
  // 문단 tokenizer 에서 그 문단 안만 본다. 아래는 marked 기본 문단 tokenizer 에 끊기만 더한 것이다.
  tokenizer: {
    paragraph(src) {
      const cap = PARAGRAPH.exec(src)
      if (!cap) return undefined
      const raw = untilDef(cap[0])
      const body = raw === cap[0] ? cap[1]! : raw
      const text = body.endsWith('\n') ? body.slice(0, -1) : body
      return { type: 'paragraph', raw, text, tokens: this.lexer.inline(text) }
    }
  },
  extensions: [
    {
      name: 'footnoteDef',
      level: 'block',
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
      // `[^x](주소)` 는 cmark-gfm 처럼 각주가 아니라 링크다.
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
          // 복귀 링크는 정의가 문단으로 끝나면 그 문단 끝에, 아니면 새 문단에 둔다(cmark-gfm 과 같다).
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
  return 'tokens' in t && t.tokens ? [t.tokens] : []
}

// 토큰을 문서 순서로 걸으며 참조와 정의를 모으고, 정의는 그 자리에서 뺀다. 정의 안의 참조도 그 정의가 있던 자리 순서로 센다.
function walk(tokens: Token[], refs: Ref[], defs: Map<string, Def>): void {
  let kept = 0
  for (const t of tokens) {
    if (t.type === 'footnoteRef') refs.push(t as Ref)
    for (const c of children(t)) walk(c, refs, defs)
    if (t.type === 'footnoteDef') {
      // 같은 라벨의 정의가 여럿이면 처음 것을 쓴다.
      const key = (t as Def).label.toLowerCase()
      if (!defs.has(key)) defs.set(key, t as Def)
    } else tokens[kept++] = t
  }
  tokens.length = kept
}

/**
 * lexing 한 문서에서 각주에 번호를 매긴다. 번호는 첫 참조 순서이고, 라벨은 대소문자를 가리지 않고 맞춘다. 정의는 원래
 * 자리에서 빼고, 참조된 것만 번호 차례로 `tokens` 끝의 목록 토큰에 담는다. 정의 없는 참조는 글자 그대로 남는다.
 * `prefix` 는 각주 id 의 머리로, 한 창에 같이 붙는 문서마다 달라야 한다.
 */
export function collectFootnotes(tokens: Token[], prefix: string): void {
  const refs: Ref[] = []
  const defs = new Map<string, Def>()
  walk(tokens, refs, defs)
  const notes = new Map<Def, Note>()
  for (const ref of refs) {
    const def = defs.get(ref.label.toLowerCase())
    if (!def) continue
    let note = notes.get(def)
    if (!note) notes.set(def, (note = { number: notes.size + 1, refs: 0, tokens: def.tokens }))
    ref.prefix = prefix
    ref.number = note.number
    ref.nth = ++note.refs
  }
  if (!notes.size) return
  const list: List = { type: 'footnotes', raw: '', prefix, notes: [...notes.values()] }
  tokens.push(list)
}
