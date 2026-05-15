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
  const hex = trimmed.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (hex) {
    const [, red, green, blue] = hex
    return `rgb(${Number.parseInt(red, 16)} ${Number.parseInt(green, 16)} ${Number.parseInt(blue, 16)} / ${alpha})`
  }

  const hsl = trimmed.match(/^hsl\((.+)\)$/i)
  if (hsl) {
    return `hsl(${hsl[1]} / ${alpha})`
  }

  return trimmed
}
