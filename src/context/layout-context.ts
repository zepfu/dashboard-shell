import { createContext, useContext } from 'react'

export type Collapsible = 'offcanvas' | 'icon' | 'none'
export type LayoutVariant = 'inset' | 'sidebar' | 'floating'

export type LayoutContextType = {
  resetLayout: () => void

  defaultCollapsible: Collapsible
  collapsible: Collapsible
  setCollapsible: (collapsible: Collapsible) => void

  defaultVariant: LayoutVariant
  variant: LayoutVariant
  setVariant: (variant: LayoutVariant) => void
}

export const LayoutContext = createContext<LayoutContextType | null>(null)

export function useLayout() {
  const context = useContext(LayoutContext)
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider')
  }
  return context
}
