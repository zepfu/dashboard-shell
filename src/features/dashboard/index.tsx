import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { TopNav } from '@/components/layout/top-nav'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { UsageReportDashboard } from './components/usage-report-dashboard'

export function Dashboard() {
  return (
    <>
      <Header>
        <TopNav links={topNav} />
        <div className='ms-auto flex items-center space-x-4'>
          <Search />
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main fluid>
        <div className='mb-4 flex items-center justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>
              General Dashboard
            </h1>
            <p className='text-sm text-muted-foreground'>
              LiteLLM usage, quota, cost, and repository activity
            </p>
          </div>
        </div>
        <UsageReportDashboard />
      </Main>
    </>
  )
}

const topNav = [
  {
    title: 'Usage',
    href: '/',
    isActive: true,
    disabled: false,
  },
]
