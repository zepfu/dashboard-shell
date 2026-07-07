import type { CSSProperties } from 'react'

type AccentStyleOptions = {
  colorVar: `--${string}`
  backgroundVar?: `--${string}`
  backgroundTint?: number
}

export function getAccentStyle(
  accentColor: string | undefined,
  { colorVar, backgroundVar, backgroundTint = 12 }: AccentStyleOptions
): CSSProperties | undefined {
  if (!accentColor) return undefined

  return {
    [colorVar]: accentColor,
    ...(backgroundVar
      ? {
          [backgroundVar]: accentBackgroundColor(accentColor, backgroundTint),
        }
      : {}),
  } as CSSProperties
}

function accentBackgroundColor(accentColor: string, tintPercent: number) {
  const alpha = Math.max(0, Math.min(tintPercent, 100)) / 100
  const trimmed = accentColor.trim()

  const hex8 = trimmed.match(
    /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i
  )
  if (hex8) {
    const [, red, green, blue, embeddedAlpha] = hex8
    const embedded = Number.parseInt(embeddedAlpha, 16) / 255
    const blendedAlpha = embedded * alpha
    return `rgb(${Number.parseInt(red, 16)} ${Number.parseInt(green, 16)} ${Number.parseInt(blue, 16)} / ${blendedAlpha})`
  }

  const hex6 = trimmed.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (hex6) {
    const [, red, green, blue] = hex6
    return `rgb(${Number.parseInt(red, 16)} ${Number.parseInt(green, 16)} ${Number.parseInt(blue, 16)} / ${alpha})`
  }

  const hex3 = trimmed.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i)
  if (hex3) {
    const [, r, g, b] = hex3
    const red = r + r
    const green = g + g
    const blue = b + b
    return `rgb(${Number.parseInt(red, 16)} ${Number.parseInt(green, 16)} ${Number.parseInt(blue, 16)} / ${alpha})`
  }

  const hsl = trimmed.match(/^hsl\((.+)\)$/i)
  if (hsl) {
    return `hsl(${hsl[1]} / ${alpha})`
  }

  return trimmed
}
