import { useState } from 'react'
import { getCookie, setCookie } from '@/lib/cookies'
import {
  LayoutContext,
  type Collapsible,
  type LayoutContextType,
  type LayoutVariant,
} from './layout-context'

const LAYOUT_COLLAPSIBLE_COOKIE_NAME = 'layout_collapsible'
const LAYOUT_VARIANT_COOKIE_NAME = 'layout_variant'
const LAYOUT_COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

const DEFAULT_VARIANT = 'inset'
const DEFAULT_COLLAPSIBLE = 'icon'

const VALID_COLLAPSIBLE = new Set<Collapsible>(['offcanvas', 'icon', 'none'])
const VALID_VARIANT = new Set<LayoutVariant>(['inset', 'sidebar', 'floating'])

function parseCollapsibleCookie(value: string | undefined): Collapsible {
  if (value && VALID_COLLAPSIBLE.has(value as Collapsible)) {
    return value as Collapsible
  }
  return DEFAULT_COLLAPSIBLE
}

function parseVariantCookie(value: string | undefined): LayoutVariant {
  if (value && VALID_VARIANT.has(value as LayoutVariant)) {
    return value as LayoutVariant
  }
  return DEFAULT_VARIANT
}

type LayoutProviderProps = {
  children: React.ReactNode
}

export function LayoutProvider({ children }: LayoutProviderProps) {
  const [collapsible, _setCollapsible] = useState<Collapsible>(() =>
    parseCollapsibleCookie(getCookie(LAYOUT_COLLAPSIBLE_COOKIE_NAME))
  )

  const [variant, _setVariant] = useState<LayoutVariant>(() =>
    parseVariantCookie(getCookie(LAYOUT_VARIANT_COOKIE_NAME))
  )

  const setCollapsible = (newCollapsible: Collapsible) => {
    _setCollapsible(newCollapsible)
    setCookie(
      LAYOUT_COLLAPSIBLE_COOKIE_NAME,
      newCollapsible,
      LAYOUT_COOKIE_MAX_AGE
    )
  }

  const setVariant = (newVariant: LayoutVariant) => {
    _setVariant(newVariant)
    setCookie(LAYOUT_VARIANT_COOKIE_NAME, newVariant, LAYOUT_COOKIE_MAX_AGE)
  }

  const resetLayout = () => {
    setCollapsible(DEFAULT_COLLAPSIBLE)
    setVariant(DEFAULT_VARIANT)
  }

  const contextValue: LayoutContextType = {
    resetLayout,
    defaultCollapsible: DEFAULT_COLLAPSIBLE,
    collapsible,
    setCollapsible,
    defaultVariant: DEFAULT_VARIANT,
    variant,
    setVariant,
  }

  return <LayoutContext value={contextValue}>{children}</LayoutContext>
}
