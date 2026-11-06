import claude from '@lobehub/icons-static-svg/icons/claude.svg?raw'
import codex from '@lobehub/icons-static-svg/icons/codex.svg?raw'
import kiro from '@lobehub/icons-static-svg/icons/kiro.svg?raw'
import type { AgentLogo } from './icons'

export type SvgBody = { viewBox: string; body: string }

/**
 * svg 파일에서 viewBox 와 루트 안의 그림을 꺼낸다. `<title>` 은 뺀다. 남겨 두면 브라우저가 그 글을 툴팁으로 띄워, 같은 자리의
 * 상태 툴팁과 겹친다.
 */
export function svgBody(svg: string): SvgBody {
  const open = svg.match(/<svg\b[^>]*>/)
  const end = svg.lastIndexOf('</svg>')
  if (!open || end < 0) throw new Error('not an svg file')
  const viewBox = open[0].match(/\bviewBox="([^"]+)"/)?.[1] ?? '0 0 24 24'
  const body = svg.slice(open.index! + open[0].length, end).replace(/<title>[^<]*<\/title>/g, '')
  return { viewBox, body }
}

export const AGENT_LOGOS: Record<AgentLogo, SvgBody> = {
  claude: svgBody(claude),
  codex: svgBody(codex),
  kiro: svgBody(kiro)
}
