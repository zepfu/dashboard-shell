import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { TopNav } from '@/components/layout/top-nav'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { UsageReportDashboard } from './components/usage-report-dashboard'

export function Dashboard() {
  return (
    <>
      <Header>
        <TopNav links={topNav} />
        <div className='ms-auto flex items-center space-x-4'>
          <Search />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main fluid>
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
