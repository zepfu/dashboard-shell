import { describe, expect, test } from 'vitest'
import { getDisplayNameInitials } from './utils'

describe('getDisplayNameInitials', () => {
  test('uses the first and last word of a display name', () => {
    expect(getDisplayNameInitials('Ada Lovelace')).toBe('AL')
    expect(getDisplayNameInitials('  Ada   Byron   Lovelace  ')).toBe('AL')
  })

  test('uses two characters for a single word and ? when empty', () => {
    expect(getDisplayNameInitials('ada')).toBe('AD')
    expect(getDisplayNameInitials('A')).toBe('A')
    expect(getDisplayNameInitials('   ')).toBe('?')
  })
})
