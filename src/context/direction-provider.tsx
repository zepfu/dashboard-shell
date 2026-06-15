import { useEffect, useState } from 'react'
import { DirectionProvider as RdxDirProvider } from '@radix-ui/react-direction'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'
import { DirectionContext, type Direction } from './direction-context'

const DEFAULT_DIRECTION = 'ltr'
const DIRECTION_COOKIE_NAME = 'dir'
const DIRECTION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

const VALID_DIRECTIONS = new Set<Direction>(['ltr', 'rtl'])

function parseDirectionCookie(value: string | undefined): Direction {
  if (value && VALID_DIRECTIONS.has(value as Direction)) {
    return value as Direction
  }
  return DEFAULT_DIRECTION
}

export function DirectionProvider({ children }: { children: React.ReactNode }) {
  const [dir, _setDir] = useState<Direction>(() =>
    parseDirectionCookie(getCookie(DIRECTION_COOKIE_NAME))
  )

  useEffect(() => {
    const htmlElement = document.documentElement
    htmlElement.setAttribute('dir', dir)
  }, [dir])

  const setDir = (dir: Direction) => {
    _setDir(dir)
    setCookie(DIRECTION_COOKIE_NAME, dir, DIRECTION_COOKIE_MAX_AGE)
  }

  const resetDir = () => {
    _setDir(DEFAULT_DIRECTION)
    removeCookie(DIRECTION_COOKIE_NAME)
  }

  return (
    <DirectionContext
      value={{
        defaultDir: DEFAULT_DIRECTION,
        dir,
        setDir,
        resetDir,
      }}
    >
      <RdxDirProvider dir={dir}>{children}</RdxDirProvider>
    </DirectionContext>
  )
}
