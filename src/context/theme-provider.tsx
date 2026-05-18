import { createContext, useCallback, useContext, useEffect } from 'react'

type Theme = 'dark'
type ResolvedTheme = 'dark'

const DEFAULT_THEME: Theme = 'dark'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  defaultTheme: Theme
  resolvedTheme: ResolvedTheme
  theme: Theme
  /** No-op: Phosphor Atlas is permanently dark. Accepts any value for backward compatibility. */
  setTheme: (theme: string) => void
  resetTheme: () => void
}

const initialState: ThemeProviderState = {
  defaultTheme: DEFAULT_THEME,
  resolvedTheme: 'dark',
  theme: DEFAULT_THEME,
  setTheme: () => null,
  resetTheme: () => null,
}

const ThemeContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light')
    root.classList.add('dark')
  }, [])

  const setTheme = useCallback((_theme: string) => {
    // no-op: Phosphor Atlas is dark-only
  }, [])

  const resetTheme = useCallback(() => {
    // no-op: Phosphor Atlas is dark-only
  }, [])

  const contextValue: ThemeProviderState = {
    defaultTheme: DEFAULT_THEME,
    resolvedTheme: 'dark',
    theme: DEFAULT_THEME,
    setTheme,
    resetTheme,
  }

  return (
    <ThemeContext value={contextValue} {...props}>
      {children}
    </ThemeContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeContext)

  if (!context) throw new Error('useTheme must be used within a ThemeProvider')

  return context
}
