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
// This keeps the test file untouched (per engineer constraints) and provides
// actual SQL parse-validation via the real dependency.
//
// We use an absolute file: URL (via require.resolve) to import the real package
// so that Vite/Vitest's 'pgsql-parser' alias (pointing back at this shim) does
// not cause infinite recursion.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const realEntry = require.resolve('pgsql-parser')
const realUrl = 'file://' + realEntry

const { parse: realParse } = await import(realUrl)

export async function parse(sql) {
  const result = await realParse(sql)
  // Return the statements array so Array.isArray + length checks succeed.
  // A successful parse with a non-empty stmts list is the validation signal.
  return result?.stmts ?? []
}
