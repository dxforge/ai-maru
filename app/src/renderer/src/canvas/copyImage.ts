export async function copyPng(png: Blob): Promise<void> {
  await window.maru.copyImage(new Uint8Array(await png.arrayBuffer()))
}

/** 이미지 문서의 그림을 원본 픽셀 크기의 PNG 로 만든다. 움직이는 그림은 `drawImage` 가 그리는 한 장만 실린다(어느 장인지 확인하지 않았다). */
export function imagePng(img: HTMLImageElement): Promise<Blob> {
  const { naturalWidth: width, naturalHeight: height } = img
  return canvasPng(width, height, (ctx) => ctx.drawImage(img, 0, 0, width, height))
}

/**
 * 화면의 mermaid 다이어그램을 100% 크기의 `dpr` 배 PNG 로 만든다. 배경은 `background` 로 채운다. SVG 는 data: URL 로
 * 읽는다. 라벨이 `foreignObject` 인 SVG 를 blob: URL 로 읽어 그리면 Chromium 이 canvas 를 내보내지 못하게 막기 때문이다.
 * `app/src/renderer/index.html` CSP 의 `img-src` 에 `data:` 가 있어야 한다.
 */
export async function diagramPng(
  svg: SVGSVGElement,
  size: { width: number; height: number },
  background: string,
  dpr: number
): Promise<Blob> {
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(standaloneSvg(svg, size))}`
  await img.decode()
  return canvasPng(Math.round(size.width * dpr), Math.round(size.height * dpr), (ctx) => {
    ctx.scale(dpr, dpr)
    ctx.fillStyle = background
    ctx.fillRect(0, 0, size.width, size.height)
    ctx.drawImage(img, 0, 0, size.width, size.height)
  })
}

export function standaloneSvg(svg: SVGSVGElement, size: { width: number; height: number }): string {
  const copy = svg.cloneNode(true) as SVGSVGElement
  for (const p of ['width', 'height', 'max-width']) copy.style.removeProperty(p)
  copy.setAttribute('width', String(size.width))
  copy.setAttribute('height', String(size.height))
  return new XMLSerializer().serializeToString(copy)
}

export function backgroundOf(el: Element): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const color = getComputedStyle(e).backgroundColor
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color
  }
  return 'white'
}

function canvasPng(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d')!)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('cannot encode the PNG'))), 'image/png')
  )
}
