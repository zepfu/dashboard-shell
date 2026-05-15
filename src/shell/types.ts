import type { ComponentType, LazyExoticComponent } from 'react'

export type RemoteRouteProps = Record<string, unknown>

export type RemoteRouteComponent =
  | ComponentType<RemoteRouteProps>
  | LazyExoticComponent<ComponentType<RemoteRouteProps>>

export interface RemoteRouteConfig {
  path: string
  component: RemoteRouteComponent
  requiresAuth?: boolean
}

export interface RemoteNavItem {
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
  children?: RemoteNavItem[]
}

export interface RemoteExtensionConfig {
  slot: string
  component: ComponentType<Record<string, unknown>>
  priority?: number
}

export interface ProjectModule {
  id: string
  name: string
  description: string
  icon: ComponentType<{ className?: string }>
  basePath: string
  routes: RemoteRouteConfig[]
  navItems: RemoteNavItem[]
  extensions?: RemoteExtensionConfig[]
  apiBase?: string
  accentColor?: string
}
