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
  /** 링크 글자 안의 참조다. 링크 안에 링크를 둘 수 없어 번호만 그린다. */
  inLink?: boolean
  /** 정의가 없을 때 그릴 토큰. 확장 없이 읽었을 때와 같게 `[` 뒤를 보통 inline 으로 읽은 것이다. */
  tokens: Token[]
}
type Def = Tokens.Generic & { type: 'footnoteDef'; label: string; tokens: Token[] }
type Note = { number: number; refs: number; tokens: Token[] }
type List = Tokens.Generic & { type: 'footnotes'; prefix: string; notes: Note[] }

// 라벨은 링크 라벨처럼 escape 하지 않은 `[`·`]` 를 담지 못하고, 각주 라벨이라 공백도 담지 못한다.
const LABEL = String.raw`(?:[^[\]\\\s]|\\\S)+`
// cmark-gfm 의 정의 시작과 같다.
const DEF_START = new RegExp(String.raw`^ {0,3}\[\^(${LABEL})\]:[ \t]*`)
const DEF_LINE = new RegExp(String.raw`\n {0,3}\[\^${LABEL}\]:`)
const REF = new RegExp(String.raw`^\[\^(${LABEL})\](?!\()`)
const INDENTED = /(?:[ \t]*\n)*(?: {4}|\t)[^\n]*(?:\n|$)/y
const PARAGRAPH = Lexer.rules.block.gfm.paragraph
// 문단의 둘째 글자부터 그 문단 끝까지. marked 는 `start` 에 문단의 둘째 글자부터 넘긴다.
const PARAGRAPH_REST = new RegExp(PARAGRAPH.source.replace('^([^\\n]+', '^([^\\n]*'))

const continuesParagraph = (line: string): boolean =>
  PARAGRAPH.exec(`x\n${line}`)?.[0].length === line.length + 2

const continues = (line: string): boolean =>
  line.trim() !== '' && continuesParagraph(line) && !DEF_START.test(line)

const LINE = /[^\n]*/y
const MARK = /\uE000(\d+)\uE001/g

type Lazy = { line: number; pos: number }

// 블록 토큰 안의 문단마다 `f` 를 부른다. 목록 항목의 문단은 `text` 토큰이다.
function paragraphs(tokens: Token[], f: (raw: string) => void): void {
  for (const t of tokens) {
    if (t.type === 'paragraph' || t.type === 'text') f(t.raw)
    else if (t.type === 'list')
      for (const item of (t as Tokens.List).items) paragraphs(item.tokens, f)
    else if ('tokens' in t && t.tokens) paragraphs(t.tokens, f)
  }
}

// `lazy` 가운데 앞 문단을 잇지 못한 첫 줄의 차례를 돌려준다. 모두 이으면 `undefined` 다. 줄마다 표시를 붙여 정의를 한 번
// lexing 하고, 표시 앞에 글자가 있는 문단에 든 줄을 이은 줄로 본다. 줄마다 그 앞까지를 다시 lexing 하면 lex 시간이 정의
// 크기의 제곱으로 늘어난다(잰 값: 중첩 목록 항목 2,000개에 9.4 s).
// `firstLoose` 가 하는 lexing 안에서 만난 정의는 lazy 줄을 판정하지 않고 모두 이은 줄로 읽는다. 안쪽 정의도 판정하면 정의를
// 한 단 겹칠 때마다 lex 시간이 두 배로 는다(잰 값: 16단에 535 ms).
const judging = new WeakSet<Lexer>()
function firstLoose(options: Lexer['options'], lines: string[], lazy: Lazy[]): number | undefined {
  const lexer = new Lexer(options)
  judging.add(lexer)
  const tagged = [...lines]
  lazy.forEach(({ line }, i) => (tagged[line] = `\uE000${i}\uE001${tagged[line]}`))
  const kept = new Set<number>()
  paragraphs(lexer.blockTokens(tagged.join('\n'), []), (raw) => {
    for (const m of raw.matchAll(MARK)) if (raw.slice(0, m.index).trim()) kept.add(Number(m[1]))
  })
  const i = lazy.findIndex((_, i) => !kept.has(i))
  return i === -1 ? undefined : i
}

// 정의 첫 줄에서 시작한 문단을 정의 줄 앞과 들여 쓴 줄 앞에서 끊는다. 들여 쓴 줄은 정의 안의 줄이라, 들여쓰기를 뗀 뒤
// 목록·인용처럼 문단을 끊는 블록이 될 수 있기 때문이다.
const FIRST_CUT = new RegExp(String.raw`${DEF_LINE.source}|\n(?: {4}|\t)`)
function untilBlock(s: string): string {
  const cut = s.search(FIRST_CUT)
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
        const line = /^[^\n]*/.exec(src.slice(pos))![0]
        const first =
          line.trim() && continuesParagraph(line) ? PARAGRAPH.exec(src.slice(pos)) : null
        if (first) {
          const raw = untilBlock(first[0])
          lines.push(raw.replace(/\n$/, ''))
          pos += raw.length
        } else {
          lines.push(line)
          pos += line.length
          if (src[pos] === '\n') pos++
        }
        const lazy: Lazy[] = []
        for (;;) {
          INDENTED.lastIndex = pos
          const more = INDENTED.exec(src)
          if (more) {
            for (const line of more[0].replace(/\n$/, '').split('\n'))
              lines.push(line.replace(/^(?: {1,4}|\t)/, ''))
            pos += more[0].length
            continue
          }
          LINE.lastIndex = pos
          const line = LINE.exec(src)![0]
          if (!continues(line) || !lines.at(-1)!.trim()) break
          lazy.push({ line: lines.length, pos })
          lines.push(line)
          pos += line.length
          if (src[pos] === '\n') pos++
        }
        const loose =
          lazy.length && !judging.has(this.lexer)
            ? firstLoose(this.lexer.options, lines, lazy)
            : undefined
        if (loose !== undefined) {
          lines.length = lazy[loose]!.line
          pos = lazy[loose]!.pos
        }
        // 정의는 문서 끝 목록에 그려지므로, 목록 항목 안에 있어도 `state.top` 을 켜고 읽는다. marked 는 `state.top` 이
        // 꺼져 있으면 문단을 `paragraph` 가 아니라 `text` 토큰으로 내기 때문이다.
        const { state } = this.lexer
        const top = state.top
        state.top = true
        const tokens = this.lexer.blockTokens(lines.join('\n'), [])
        state.top = top
        const def: Def = { type: 'footnoteDef', raw: src.slice(0, pos), label: m[1]!, tokens }
        return def
      },
      renderer: () => ''
    },
    {
      name: 'footnoteRef',
      level: 'inline',
      tokenizer(src) {
        const m = REF.exec(src)
        if (!m) return undefined
        const tokens: Token[] = [
          { type: 'text', raw: '[', text: '[', escaped: false },
          ...this.lexer.inlineTokens(m[0].slice(1))
        ]
        const ref: Ref = { type: 'footnoteRef', raw: m[0], label: m[1]!, tokens }
        return ref
      },
      renderer(token) {
        const { prefix, number, nth, inLink, tokens } = token as Ref
        if (number === undefined) return this.parser.parseInline(tokens)
        const id = refId(prefix!, number, nth!)
        if (inLink) return `<sup id="${id}">${number}</sup>`
        return `<sup><a id="${id}" href="#${noteId(prefix!, number)}">${number}</a></sup>`
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
          // ↩ 를 마지막 문단 끝에 붙이려고, 끝의 빈 줄 토큰을 건너뛰고 마지막 토큰이 문단인지 본다. 안쪽 정의를 뺀 자리에도
          // 빈 줄 토큰이 남는다.
          const html =
            tokens.findLast((t) => !isSpace(t))?.type === 'paragraph'
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
  // 정의가 없을 때 그릴 토큰에는 참조가 없다.
  if (t.type === 'footnoteRef') return []
  if (t.type === 'list') return [(t as Tokens.List).items]
  if (t.type === 'table') {
    const { header, rows } = t as Tokens.Table
    return [...header, ...rows.flat()].map((c) => c.tokens)
  }
  // 이미지의 alt 는 글자로만 그려지므로 그 안의 참조는 각주가 아니다.
  if (t.type === 'image') return []
  return 'tokens' in t && t.tokens ? [t.tokens] : []
}

// 문서 순서로 참조와 정의를 `seq` 에 모으고, 정의는 원래 자리에서 뺀다. 정의 안은 따로 순회해 `inner` 에 둔다. 그 정의가
// 목록에 실릴지는 문서를 다 순회한 뒤에야 알기 때문이다. 정의를 뺐으면 참을 돌려준다.
function walk(
  tokens: Token[],
  seq: (Ref | Def)[],
  defs: Map<string, Def>,
  inner: Map<Def, (Ref | Def)[]>,
  inLink = false
): boolean {
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
    if (t.type === 'footnoteRef') {
      ;(t as Ref).inLink = inLink
      seq.push(t as Ref)
    }
    let emptied = false
    for (const c of children(t))
      if (walk(c, seq, defs, inner, inLink || t.type === 'link') && c.every(isSpace)) emptied = true
    // 정의만 담았던 인용은 빈 테두리만 남으므로 그리지 않는다.
    if (emptied && t.type === 'blockquote') continue
    tokens[kept++] = t
  }
  const removed = kept < tokens.length
  tokens.length = kept
  return removed
}

const isSpace = (t: Token): boolean => t.type === 'space'

/**
 * lexing 한 문서에서 각주에 번호를 매긴다. 번호는 첫 참조 순서이고, 정의 안의 참조는 그 정의가 있던 자리에서 센다.
 * 라벨은 대소문자를 가리지 않고 맞추고, 같은 라벨의 정의가 여럿이면 처음 것을 쓴다. 정의는 원래 자리에서 빼고,
 * 본문이나 목록에 실린 정의에서 참조된 것만 번호 차례로 목록 토큰에 담아 돌려준다. 번호 매긴 참조가 없으면 목록도 없다.
 * 정의 없는 참조는 글자 그대로 남는다. `prefix` 는 각주 id 의 접두사로, 한 창에 같이 붙는 문서마다 달라야 한다.
 */
export function collectFootnotes(tokens: Token[], prefix: string): Token | undefined {
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

  // 목록에 실리지 않는 정의 안도 순회한다. 그 안에 들여 써 둔 정의가 목록에 실릴 수 있기 때문이다. 그 안의 참조는 세지 않는다.
  const notes = new Map<Def, Note>()
  const number = (items: (Ref | Def)[], counted: boolean): void => {
    for (const it of items) {
      if (it.type === 'footnoteDef') {
        number(inner.get(it as Def)!, shown.has(it as Def))
        continue
      }
      if (!counted) continue
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
  number(seq, true)
  if (!notes.size) return undefined
  const list: List = { type: 'footnotes', raw: '', prefix, notes: [...notes.values()] }
  return list
}
