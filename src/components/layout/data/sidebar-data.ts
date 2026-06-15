import {
  hostDashboardTeam,
  remoteDashboardHref,
  remoteDashboardMetadata,
} from '@/shell/remote-dashboard-metadata'
import {
  Construction,
  LayoutDashboard,
  Monitor,
  Bug,
  ListTodo,
  FileX,
  HelpCircle,
  Lock,
  Bell,
  Package,
  Palette,
  ServerOff,
  Settings,
  Wrench,
  UserCog,
  UserX,
  Users,
  MessagesSquare,
  ShieldCheck,
} from 'lucide-react'
import { ClerkLogo } from '@/assets/clerk-logo'
import { type SidebarData } from '../types'

const remoteDashboardTeams = remoteDashboardMetadata.map((dashboard) => ({
  name: dashboard.name,
  logo: dashboard.icon,
  plan: 'Remote Module',
  basePath: dashboard.basePath,
  accentColor: dashboard.accentColor,
}))

const remoteDashboardNavItems = remoteDashboardMetadata.map((dashboard) => ({
  title: dashboard.name,
  url: remoteDashboardHref(dashboard, dashboard.defaultRoutePath),
  icon: dashboard.icon,
  accentColor: dashboard.accentColor,
}))

const baseNavGroups = [
  {
    title: 'Dashboards',
    items: remoteDashboardNavItems,
  },
  {
    title: 'Other',
    items: [
      {
        title: 'Settings',
        icon: Settings,
        items: [
          {
            title: 'Profile',
            url: '/settings',
            icon: UserCog,
          },
          {
            title: 'Account',
            url: '/settings/account',
            icon: Wrench,
          },
          {
            title: 'Appearance',
            url: '/settings/appearance',
            icon: Palette,
          },
          {
            title: 'Notifications',
            url: '/settings/notifications',
            icon: Bell,
          },
          {
            title: 'Display',
            url: '/settings/display',
            icon: Monitor,
          },
        ],
      },
      {
        title: 'Help Center',
        url: '/help-center',
        icon: HelpCircle,
      },
    ],
  },
]

// Scaffold/demo nav groups gated behind DEV only.
// These items are only included in development builds (import.meta.env.DEV is true).
// In production builds, only the base nav groups (Dashboards + Other) are shown.
const scaffoldNavGroups = [
  {
    title: 'General',
    items: [
      {
        title: 'Dashboard',
        url: '/',
        icon: LayoutDashboard,
      },
      {
        title: 'Tasks',
        url: '/tasks',
        icon: ListTodo,
      },
      {
        title: 'Apps',
        url: '/apps',
        icon: Package,
      },
      {
        title: 'Chats',
        url: '/chats',
        badge: '3',
        icon: MessagesSquare,
      },
      {
        title: 'Users',
        url: '/users',
        icon: Users,
      },
      {
        title: 'Secured by Clerk',
        icon: ClerkLogo,
        items: [
          {
            title: 'Sign In',
            url: '/clerk/sign-in',
          },
          {
            title: 'Sign Up',
            url: '/clerk/sign-up',
          },
          {
            title: 'User Management',
            url: '/clerk/user-management',
          },
        ],
      },
    ],
  },
  {
    title: 'Pages',
    items: [
      {
        title: 'Auth',
        icon: ShieldCheck,
        items: [
          {
            title: 'Sign In',
            url: '/sign-in',
          },
          {
            title: 'Sign In (2 Col)',
            url: '/sign-in-2',
          },
          {
            title: 'Sign Up',
            url: '/sign-up',
          },
          {
            title: 'Forgot Password',
            url: '/forgot-password',
          },
          {
            title: 'OTP',
            url: '/otp',
          },
        ],
      },
      {
        title: 'Errors',
        icon: Bug,
        items: [
          {
            title: 'Unauthorized',
            url: '/errors/unauthorized',
            icon: Lock,
          },
          {
            title: 'Forbidden',
            url: '/errors/forbidden',
            icon: UserX,
          },
          {
            title: 'Not Found',
            url: '/errors/not-found',
            icon: FileX,
          },
          {
            title: 'Internal Server Error',
            url: '/errors/internal-server-error',
            icon: ServerOff,
          },
          {
            title: 'Maintenance Error',
            url: '/errors/maintenance-error',
            icon: Construction,
          },
        ],
      },
    ],
  },
]

const navGroups = import.meta.env.DEV
  ? [
      ...baseNavGroups.slice(0, 1),
      ...scaffoldNavGroups,
      ...baseNavGroups.slice(1),
    ]
  : baseNavGroups

export const sidebarData: SidebarData = {
  user: {
    name: 'Dashboard Shell',
    email: 'local dashboard',
  },
  teams: [hostDashboardTeam, ...remoteDashboardTeams],
  navGroups,
}
