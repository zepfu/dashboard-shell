import type { ComponentType, LazyExoticComponent } from 'react'

export type RemoteRouteProps = Record<string, unknown>

export type RemoteRouteComponent =
  | ComponentType<RemoteRouteProps>
  | LazyExoticComponent<ComponentType<RemoteRouteProps>>

export interface RemoteRouteConfig {
  path: string
  component: RemoteRouteComponent
}

export interface RemoteNavItem {
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
  children?: RemoteNavItem[]
}

export interface ProjectModule {
  id: string
  name: string
  description: string
  icon: ComponentType<{ className?: string }>
  basePath: string
  routes: RemoteRouteConfig[]
  navItems: RemoteNavItem[]
  apiBase?: string
  accentColor?: string
}
