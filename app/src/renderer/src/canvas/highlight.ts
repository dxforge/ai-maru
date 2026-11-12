import { escapeAttribute, escapeText } from 'entities'
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledLanguages, bundledLanguagesInfo } from 'shiki/langs'
import { bundledThemes } from 'shiki/themes'

// worker 와 단위 테스트만 이 모듈을 읽는다. renderer 가 읽으면 언어 문법 chunk 가 worker 의 것과 따로 한 벌 더 생긴다.

const LIGHT_THEME = 'github-light'
const DARK_THEME = 'github-dark-dimmed'

// shiki 의 언어 id·alias 에 없는 흔한 확장자다.
const EXTRA_EXTENSIONS: Record<string, string> = {
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  cc: 'cpp',
  cxx: 'cpp'
}

const LANGUAGES = new Map<string, string>()
for (const l of bundledLanguagesInfo) {
  LANGUAGES.set(l.id, l.id)
  for (const a of l.aliases ?? []) LANGUAGES.set(a, l.id)
}
for (const [ext, id] of Object.entries(EXTRA_EXTENSIONS)) LANGUAGES.set(ext, id)

export function languageFor(name: string): string | null {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot > 0 ? lower.slice(dot + 1) : ''
  return LANGUAGES.get(ext) ?? LANGUAGES.get(lower) ?? null
}

/** 줄마다의 토큰을 줄바꿈으로 이은 HTML 로 만든다. 색은 `--shiki-light`·`--shiki-dark` 로 두고 CSS 가 고른다. */
export function tokensHtml(lines: readonly (readonly ThemedToken[])[]): string {
  return lines
    .map((tokens) =>
      tokens
        .map((t) => {
          const style = Object.entries(t.htmlStyle ?? {})
            .map(([k, v]) => `${k}:${v}`)
            .join(';')
          return `<span style="${escapeAttribute(style)}">${escapeText(t.content)}</span>`
        })
        .join('')
    )
    .join('\n')
}

// WASM 을 쓰는 oniguruma 엔진 대신 JavaScript 정규식 엔진을 쓴다. renderer 의 CSP(`index.html`)에 `wasm-unsafe-eval` 이
// 없기 때문이다. 그 CSP 가 worker 에도 걸리는지는 확인하지 않았다.
let highlighter: Promise<HighlighterCore> | undefined
const getHighlighter = (): Promise<HighlighterCore> =>
  (highlighter ??= createHighlighterCore({
    themes: [bundledThemes[LIGHT_THEME], bundledThemes[DARK_THEME]],
    langs: [],
    engine: createJavaScriptRegexEngine()
  }))

/** `name` 의 언어로 강조한 HTML. 모르는 언어면 null 이다. `code` 는 `prepareCode` 를 거친 글자다. */
export async function highlightCode(code: string, name: string): Promise<string | null> {
  const lang = languageFor(name)
  if (!lang) return null
  const hl = await getHighlighter()
  if (!hl.getLoadedLanguages().includes(lang)) {
    await hl.loadLanguage(bundledLanguages[lang as keyof typeof bundledLanguages])
  }
  const { tokens } = hl.codeToTokens(code, {
    lang,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false
  })
  return tokensHtml(tokens)
}
