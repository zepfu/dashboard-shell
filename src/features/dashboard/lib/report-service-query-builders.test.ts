/**
 * Frontend-owned contract tests for report-service query-builder ownership.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const REPORT_SERVICE_IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+[\s\S]*?\s+from\s+['"][^'"]*server\/report-service\.mjs['"]/

async function collectDashboardSourceFiles(baseDir: string): Promise<string[]> {
  const results: string[] = []
  const entries = await readdir(baseDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue
    }

    const candidate = join(baseDir, entry.name)
    if (entry.isDirectory()) {
      const nested = await collectDashboardSourceFiles(candidate)
      results.push(...nested)
      continue
    }

    if (entry.isFile()) {
      const extension = extname(entry.name)
      if (extension === '.ts' || extension === '.tsx') {
        results.push(candidate)
      }
    }
  }

  return results
}

describe('report-service query-builder test ownership', () => {
  test('frontend dashboard source does not import the server-only module', async () => {
    const dashboardRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    const files = await collectDashboardSourceFiles(dashboardRoot)
    const importingFiles = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (REPORT_SERVICE_IMPORT_RE.test(source)) {
        importingFiles.push(relative(dashboardRoot, file))
      }
    }

    expect(importingFiles).toEqual([])
  })
})
