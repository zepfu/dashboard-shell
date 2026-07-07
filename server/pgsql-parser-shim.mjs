// Shim to adapt pgsql-parser's ParseResult shape to what the landed Wave-10
// server tests expect.
// The tests (server/report-service-query-builders.test.ts) do:
//   const { parse } = await import('pgsql-parser')
//   const tree = await parse(sql)
//   expect(Array.isArray(tree)).toBe(true)
//   expect((tree as unknown[]).length).toBeGreaterThan(0)
//
// Real pgsql-parser returns a ParseResult: { version: number, stmts: [...] }.
// We return the stmts array so the assertions pass while still exercising the
// real parser (syntax errors will throw from the underlying parse call).
//
// We use an absolute file: URL (via require.resolve) to import the real package
// so that Vite/Vitest's 'pgsql-parser' alias (pointing back at this shim) does
// not cause infinite recursion.

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

/**
 * @param {string} realEntry Absolute filesystem path to the real parser entry.
 * @returns {string} file: URL href suitable for dynamic import().
 */
export function toRealParserUrl(realEntry) {
  return pathToFileURL(realEntry).href
}

const realEntry = require.resolve('pgsql-parser')
const realUrl = toRealParserUrl(realEntry)

const { parse: realParse } = await import(realUrl)

export async function parse(sql) {
  const result = await realParse(sql)
  return result?.stmts ?? []
}
