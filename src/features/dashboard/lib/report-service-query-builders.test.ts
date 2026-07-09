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

  test('test_frontend_query_builders_no_sibling_source_scrape', async () => {
    const selfPath = fileURLToPath(import.meta.url)
    const source = await readFile(selfPath, 'utf8')
    expect(source).not.toMatch(
      /server\s*,\s*\n\s*['"]report-service-query-builders\.test\.ts['"]/
    )
    expect(source).not.toMatch(/hasParseValidationDescribe/)
    expect(source).not.toMatch(/expectParsableSQL/)
    expect(source).not.toMatch(
      /test\(\s*['"]server suite owns query-builder contract assertions['"]/
    )
  })

  test('server suite owns query-builder contract assertions', async () => {
    const serverSuite = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'server',
      'report-service-query-builders.test.ts'
    )
    const source = await readFile(serverSuite, 'utf8')
    const hasReportServiceImport =
      /from ['"]\.\/report-service(?:\.mjs)?['"]/.test(source)
    const hasParseValidationDescribe =
      /describe\(\s*['"][^'"]*parse-validation/i.test(source)
    const hasParserShapeValidation = /expectParsableSQL/.test(source)
    const hasCanonicalBuilderCoverage = /buildUsageQuery/.test(source)

    expect(hasReportServiceImport).toBe(true)
    expect(hasParseValidationDescribe).toBe(true)
    expect(hasParserShapeValidation).toBe(true)
    expect(hasCanonicalBuilderCoverage).toBe(true)
  })
})
