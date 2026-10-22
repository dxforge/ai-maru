import { isGenericFamily } from './terminal'

// 글꼴마다 폭이 갈리는 글자들이다. 라틴 글자가 없는 글꼴(한글 전용, 아이콘 글꼴)도 잡히게 한글과 Nerd Font
// 글자를 섞는다.
const SAMPLE = 'mmmmmmmmmmlli10WQ@한글\uEA60\uF418'
const FALLBACKS = ['monospace', 'serif']

let ctx: CanvasRenderingContext2D | null | undefined

/**
 * `names` 가운데 이 앱에서 쓸 수 없는 글꼴과 generic family 키워드를 돌려준다. CSS 는 없는 글꼴과 지원하지
 * 않는 키워드를 건너뛰고 fallback 글꼴로 그리므로, `monospace`·`serif` 두 fallback 과 폭이 모두 같으면 쓸 수
 * 없는 것으로 본다. 키워드는 `parseConfig` 가 넣는 대로 따옴표 없이 잰다. `document.fonts.check` 는 시스템
 * 글꼴의 설치 여부를 알려 주지 않고 `queryLocalFonts` 는 권한을 거쳐야 해서 쓰지 않는다.
 */
export function missingFonts(names: string[]): string[] {
  if (!names.length) return []
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx) return []
  const width = (font: string): number => {
    ctx!.font = `32px ${font}`
    return ctx!.measureText(SAMPLE).width
  }
  const bundled = new Set([...document.fonts].map((f) => f.family.replace(/^(['"])(.*)\1$/, '$2')))
  const fallbacks = FALLBACKS.map((f) => [f, width(f)] as const)
  return names.filter((name) => {
    const css = isGenericFamily(name) ? name : `"${name}"`
    return !bundled.has(name) && fallbacks.every(([f, w]) => width(`${css}, ${f}`) === w)
  })
}
