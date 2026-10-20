export const FONT_SIZE = 14

export const LINE_HEIGHT = 1.2

const HANGUL_FAMILY = 'Maru Hangul'

/** 프롬프트·TUI 가 쓰는 Nerd Font 글자는 함께 실은 `Symbols Nerd Font Mono` 로 그린다(`style.css`). */
export const FONT_FAMILY = `Menlo, '${HANGUL_FAMILY}', 'Symbols Nerd Font Mono', monospace`

// D2Coding 은 영문이 좁고 `|` 가 끊긴 막대라 한글에만 쓴다. D2Coding 은 앱에 싣지 않는다. 설치되지 않았으면
// 한글은 OS 의 fallback 글꼴이 그린다.
const HANGUL_FACES = [
  { src: "local('D2Coding')", weight: 'normal' },
  { src: "local('D2Coding Bold'), local('D2CodingBold')", weight: 'bold' }
]
const HANGUL_RANGE = 'U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7A3, U+D7B0-D7FF'

/**
 * 호출하는 쪽은 터미널을 만들기 전에 이 Promise 를 기다린다. 로드되기 전에 그린 글자는 로드된 뒤에도 fallback 글꼴로
 * 남는다. WebGL renderer 는 그 글자를 glyph atlas 에 담아 다시 그리지 않는다. Nerd Font 글자는 빈 네모로 남는다.
 */
export async function loadFonts(): Promise<void> {
  await Promise.allSettled([
    document.fonts.load("1em 'Symbols Nerd Font Mono'"),
    ...HANGUL_FACES.map(async ({ src, weight }) => {
      const face = new FontFace(HANGUL_FAMILY, src, { weight, unicodeRange: HANGUL_RANGE })
      document.fonts.add(await face.load())
    })
  ])
}
