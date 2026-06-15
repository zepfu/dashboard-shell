import {
  Activity,
  AlertOctagon,
  Bot,
  BookOpen,
  Command,
  Database,
  FileText,
  FlaskConical,
  GitBranch,
  Heart,
  LayoutDashboard,
  ListChecks,
  Map,
  Network,
  Package,
  Pill,
  Search,
  Settings,
  ShieldCheck,
  Telescope,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'
import type { ProjectModule, RemoteNavItem } from './types'

export type RemoteDashboardKey =
  | 'aawm'
  | 'aawm-tap'
  | 'aawm-observe'
  | 'aegis'
  | 'sluice'

export type RemoteDashboardMetadataEntry = {
  key: RemoteDashboardKey
  moduleId: string
  name: string
  description: string
  icon: ProjectModule['icon']
  basePath: string
  apiBase: string
  accentColor: string
  defaultRoutePath: string
  navItems: RemoteNavItem[]
}

export const remoteDashboardMetadata = [
  {
    key: 'aawm',
    moduleId: 'aawm-dashboard',
    name: 'AAWM',
    description: 'AAWM platform operations',
    icon: LayoutDashboard,
    basePath: '/aawm',
    apiBase: '/api/aawm',
    accentColor: 'hsl(220 70% 50%)',
    defaultRoutePath: '/',
    navItems: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard },
      { label: 'Agents', path: '/agents', icon: Bot },
      { label: 'Tasks', path: '/tasks', icon: ListChecks },
      { label: 'Tenants', path: '/tenants', icon: Users },
      { label: 'Metrics', path: '/metrics', icon: TrendingUp },
      { label: 'Activity', path: '/activity', icon: Activity },
      { label: 'TriStore', path: '/tristore', icon: Database },
      { label: 'Repos', path: '/repos', icon: GitBranch },
      { label: 'Errors', path: '/errors', icon: AlertOctagon },
      { label: 'Logs', path: '/logs', icon: FileText },
    ],
  },
  {
    key: 'aawm-tap',
    moduleId: 'aawm-tap-dashboard',
    name: 'AAWM TAP',
    description: 'Retrieval and process control',
    icon: LayoutDashboard,
    basePath: '/aawm-tap',
    apiBase: '/api/aawm-tap',
    accentColor: 'hsl(220 70% 50%)',
    defaultRoutePath: '/overview',
    navItems: [
      { label: 'Overview', path: '/overview', icon: LayoutDashboard },
      { label: 'Processes', path: '/processes', icon: ListChecks },
      { label: 'Watchlist', path: '/watchlist', icon: ShieldCheck },
      { label: 'Sources', path: '/sources', icon: Database },
      { label: 'Search', path: '/search', icon: Search },
      { label: 'Graph', path: '/graph', icon: GitBranch },
      { label: 'Admin', path: '/admin', icon: Activity },
    ],
  },
  {
    key: 'aawm-observe',
    moduleId: 'aawm-observe-dashboard',
    name: 'AAWM Observe',
    description: 'Pytest and quality telemetry',
    icon: Telescope,
    basePath: '/aawm-observe',
    apiBase: '/api/aawm-observe',
    accentColor: 'hsl(188 70% 42%)',
    defaultRoutePath: '/overview',
    navItems: [
      { label: 'Overview', path: '/overview', icon: LayoutDashboard },
      { label: 'Suites', path: '/suites', icon: ListChecks },
      { label: 'Findings', path: '/findings', icon: ShieldCheck },
      { label: 'Trends', path: '/trends', icon: TrendingUp },
    ],
  },
  {
    key: 'aegis',
    moduleId: 'aegis-dashboard',
    name: 'Aegis',
    description: 'Personal genomics review and interpretation',
    icon: LayoutDashboard,
    basePath: '/aegis',
    apiBase: '/api/aegis',
    accentColor: 'hsl(280 65% 50%)',
    defaultRoutePath: '/',
    navItems: [
      { label: 'Overview', path: '/', icon: LayoutDashboard },
      { label: 'Summary', path: '/summary', icon: FileText },
      { label: 'ClinVar', path: '/clinvar', icon: Activity },
      { label: 'PharmGKB', path: '/pharmgkb', icon: Pill },
      { label: 'GWAS', path: '/gwas', icon: TrendingUp },
      { label: 'Search', path: '/search', icon: Search },
      { label: 'Ancestry', path: '/ancestry', icon: Map },
      { label: 'Sexual Health', path: '/sexual-health', icon: Heart },
      { label: 'Supplements', path: '/supplements', icon: FlaskConical },
      { label: 'Adverse Events', path: '/adverse-events', icon: AlertOctagon },
      { label: 'Graph', path: '/graph', icon: Network },
      { label: 'Reference', path: '/reference', icon: BookOpen },
      { label: 'Data Sources', path: '/data-sources', icon: Database },
      { label: 'Pipelines', path: '/pipelines', icon: ListChecks },
      { label: 'Project', path: '/project', icon: Telescope },
    ],
  },
  {
    key: 'sluice',
    moduleId: 'sluice',
    name: 'Sluice',
    description: 'Product-generation pipeline operations',
    icon: LayoutDashboard,
    basePath: '/sluice',
    apiBase: '/api/sluice',
    accentColor: 'hsl(142 71% 45%)',
    defaultRoutePath: '/overview',
    navItems: [
      { label: 'Overview', path: '/overview', icon: LayoutDashboard },
      { label: 'Pipeline', path: '/pipeline', icon: Activity },
      { label: 'Modules', path: '/modules', icon: Zap },
      { label: 'Products', path: '/products', icon: Package },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
] satisfies RemoteDashboardMetadataEntry[]

export const hostDashboardTeam = {
  name: 'Dashboard Shell',
  logo: Command,
  plan: 'Host App',
  basePath: '/',
}

export function remoteDashboardHref(
  config: Pick<RemoteDashboardMetadataEntry, 'basePath'>,
  routePath: string
) {
  const normalizedRoutePath = normalizeRemoteRoutePath(routePath)
  if (normalizedRoutePath === '/') return config.basePath
  return `${config.basePath}${normalizedRoutePath}`
}

export function normalizeRemoteRoutePath(routePath: string | undefined) {
  if (routePath === undefined || routePath.trim() === '') return '/'
  const routeOnly = routePath.split('?')[0]?.split('#')[0] ?? ''
  const withLeadingSlash = routeOnly.startsWith('/')
    ? routeOnly
    : `/${routeOnly}`
  const normalized = withLeadingSlash.replace(/\/+$/, '')
  return normalized === '' ? '/' : normalized
}
