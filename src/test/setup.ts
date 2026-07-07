import '@testing-library/jest-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export const server = setupServer(
  http.get('/api/shell/health', () =>
    HttpResponse.json({
      ok: true,
      pgBouncerSidecars: {
        status: 'unknown',
        sidecars: [],
      },
    })
  )
)

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })
}

const JSdom_LAYOUT_WIDTH = 1024

function parseCssPx(value: string | null | undefined): number | null {
  if (value == null || value === '') return null
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : null
}

function parsePercentWidth(
  styleWidth: string,
  parentWidth: number
): number | null {
  const trimmed = styleWidth.trim()
  if (!trimmed.endsWith('%')) return null
  const pct = parseFloat(trimmed)
  if (!Number.isFinite(pct)) return null
  return (pct / 100) * parentWidth
}

function parseCalcPercentMinusPx(
  flexBasis: string,
  parentWidth: number
): number | null {
  const m = /^calc\(\s*([\d.]+)%\s*-\s*([\d.]+)px\s*\)$/i.exec(flexBasis.trim())
  if (!m) return null
  const pct = parseFloat(m[1]!)
  const px = parseFloat(m[2]!)
  if (!Number.isFinite(pct) || !Number.isFinite(px)) return null
  return Math.max(0, (pct / 100) * parentWidth - px)
}

function flexBasisFromShorthand(flex: string): string {
  const t = flex.trim()
  const calcIdx = t.indexOf('calc(')
  if (calcIdx >= 0) return t.slice(calcIdx)
  const parts = t.split(/\s+/)
  return parts[parts.length - 1] ?? ''
}

function layoutWidthFromStyle(el: HTMLElement, parentWidth: number): number {
  const flex = el.style.flex
  if (flex) {
    const basis = flexBasisFromShorthand(flex)
    const fromCalc = parseCalcPercentMinusPx(basis, parentWidth)
    if (fromCalc != null) return fromCalc
    const fromBasisPct = parsePercentWidth(basis, parentWidth)
    if (fromBasisPct != null) return fromBasisPct
  }
  const w = el.style.width
  if (w) {
    const fromPct = parsePercentWidth(w, parentWidth)
    if (fromPct != null) return fromPct
  }
  const ow = el.offsetWidth
  return ow > 0 ? ow : 0
}

function resolveQuotaBarWidthPx(barEl: HTMLElement): number {
  const w = barEl.style.width?.trim()
  if (w === '100%') {
    const parent = barEl.parentElement
    if (parent != null && parent.clientWidth > 0) return parent.clientWidth
    return JSdom_LAYOUT_WIDTH
  }
  const px = parseCssPx(w)
  if (px != null && px > 0) return px
  const parent = barEl.parentElement
  if (parent != null && parent.clientWidth > 0) return parent.clientWidth
  return JSdom_LAYOUT_WIDTH
}

function installQuotaBarLayoutPolyfill(): void {
  if (typeof HTMLElement === 'undefined') return
  const proto = HTMLElement.prototype
  if (
    (proto as { __quotaBarLayoutPolyfill?: boolean }).__quotaBarLayoutPolyfill
  ) {
    return
  }
  const native = proto.getBoundingClientRect
  proto.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const rect = native.call(this)

    const isQuotaBar = this.classList.contains('quota-row-bar')
    const isQuotaInterval = this.classList.contains('quota-interval')
    const isProjection = this.classList.contains('qbar-projection')

    if (!isQuotaBar && !isQuotaInterval && !isProjection) {
      if (rect.width > 0 && rect.height > 0) return rect
      return rect
    }

    const barEl = isQuotaBar
      ? this
      : (this.closest('.quota-row-bar') as HTMLElement | null)

    const barWidth =
      barEl != null ? resolveQuotaBarWidthPx(barEl) : JSdom_LAYOUT_WIDTH

    const heightPx =
      parseCssPx(this.style.height) ??
      (isQuotaBar || isQuotaInterval ? 6 : rect.height)

    if (isQuotaBar) {
      const w = barWidth
      const h = heightPx || 6
      return new DOMRect(0, 0, w, h)
    }

    if (isQuotaInterval && barEl) {
      const parentW = barWidth
      const w = layoutWidthFromStyle(this, parentW)
      const segments = Array.from(
        barEl.querySelectorAll('.quota-interval')
      ) as HTMLElement[]
      const idx = segments.indexOf(this)
      let left = 0
      const gapPx = parseCssPx(barEl.style.gap) ?? 2
      for (let i = 0; i < idx; i += 1) {
        left += layoutWidthFromStyle(segments[i]!, parentW)
        if (gapPx > 0) left += gapPx
      }
      const h = 6
      return new DOMRect(left, 0, Math.max(w, 1), h)
    }

    if (isProjection && barEl) {
      const parentW = barWidth
      const tickW = parseCssPx(this.style.width) ?? 2
      const leftStyle = this.style.left
      const rightStyle = this.style.right
      let left = 0
      if (leftStyle.includes('calc(100% - 2px)')) {
        left = parentW - tickW
      } else if (rightStyle === '0' || rightStyle === '0px') {
        left = parentW - tickW
      } else if (leftStyle.endsWith('%')) {
        const pct = parseFloat(leftStyle)
        if (Number.isFinite(pct)) left = (pct / 100) * parentW
      }
      const h = 6
      return new DOMRect(left, 0, tickW, h)
    }

    return rect
  }
  ;(proto as { __quotaBarLayoutPolyfill?: boolean }).__quotaBarLayoutPolyfill =
    true
}

/** jsdom does not perform full layout; give the document a definite width so %/flex bars measure in tests. */
function applyJsdomLayoutViewport(): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.width = `${JSdom_LAYOUT_WIDTH}px`
  document.documentElement.style.height = '768px'
  document.body.style.width = `${JSdom_LAYOUT_WIDTH}px`
  document.body.style.height = '768px'
  document.body.style.margin = '0'
}

if (typeof document !== 'undefined') {
  applyJsdomLayoutViewport()
  installQuotaBarLayoutPolyfill()
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  applyJsdomLayoutViewport()
  installQuotaBarLayoutPolyfill()
})

afterEach(() => {
  server.resetHandlers()
  applyJsdomLayoutViewport()
})

afterAll(() => {
  server.close()
})
