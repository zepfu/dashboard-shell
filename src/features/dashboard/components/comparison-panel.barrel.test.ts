/**
 * D1-451 Wave 3 — comparison-panel.ts barrel contract (W-2).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

test('D1-451_W2_barrel_exports_computeDeltaPct_for_production_importers', () => {
  const barrelPath = path.join(import.meta.dirname, 'comparison-panel.ts')
  const source = readFileSync(barrelPath, 'utf8')
  expect(source).toMatch(/export\s*\{[\s\S]*computeDeltaPct/)
})

test('D1-451_W2_computeDeltaPct_importable_from_barrel', async () => {
  const barrel = await import('./comparison-panel')
  expect(typeof barrel.computeDeltaPct).toBe('function')
  expect(barrel.computeDeltaPct(150, 100)).toBeCloseTo(50)
})
