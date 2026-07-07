import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parse, toRealParserUrl } from './pgsql-parser-shim.mjs'

describe('pgsql-parser-shim', () => {
  test('toRealParserUrl matches pathToFileURL for a simulated Windows backslash path', () => {
    const winLike = 'C:\\Users\\dev\\node_modules\\pgsql-parser\\index.js'
    const viaHelper = toRealParserUrl(winLike)
    const viaNode = pathToFileURL(winLike).href

    expect(viaHelper).toBe(viaNode)
    expect(viaHelper.startsWith('file:///')).toBe(true)
    expect(viaHelper).not.toBe('file://' + winLike)
  })

  test('toRealParserUrl does not use raw file:// concatenation for posix paths with spaces', () => {
    const posixPath = '/tmp/my project/node_modules/pgsql-parser/index.js'
    const viaHelper = toRealParserUrl(posixPath)
    const naive = 'file://' + posixPath

    expect(viaHelper).toBe(pathToFileURL(posixPath).href)
    expect(viaHelper).not.toBe(naive)
  })

  test('parse returns a non-empty stmts array for simple SQL', async () => {
    const tree = await parse('SELECT 1')
    expect(Array.isArray(tree)).toBe(true)
    expect(tree.length).toBeGreaterThan(0)
  })
})
