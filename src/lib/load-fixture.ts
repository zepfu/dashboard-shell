/**
 * Defensive JSON fixture loading: skip invalid rows with console.warn instead of
 * failing module import (Wave 10 — P12-F3).
 */
export function loadFixture<TRaw, T>(
  rows: readonly TRaw[],
  parse: (row: TRaw, index: number) => T,
  label: string
): T[] {
  const loaded: T[] = []
  rows.forEach((row, index) => {
    try {
      loaded.push(parse(row, index))
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(
        `[${label}] Skipping invalid fixture row at index ${index}:`,
        error
      )
    }
  })
  return loaded
}
