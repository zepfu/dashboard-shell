import * as React from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronsUpDown } from 'lucide-react'
import { getAccentStyle } from '@/lib/accent-color'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

type TeamSwitcherProps = {
  teams: {
    name: string
    logo: React.ElementType
    plan: string
    basePath: string
    accentColor?: string
  }[]
}

export function TeamSwitcher({ teams }: TeamSwitcherProps) {
  const { isMobile } = useSidebar()
  const location = useLocation()
  const activeTeam = React.useMemo(
    () => activeTeamForPath(teams, location.pathname),
    [location.pathname, teams]
  )
  const activeAccentStyle = getAccentStyle(activeTeam.accentColor, {
    colorVar: '--team-accent',
    backgroundVar: '--team-accent-bg',
    backgroundTint: 14,
  })

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size='lg'
              className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
            >
              <div
                style={activeAccentStyle}
                className={cn(
                  'flex aspect-square size-8 items-center justify-center rounded-lg',
                  activeTeam.accentColor
                    ? 'bg-[var(--team-accent)] text-white shadow-sm'
                    : 'bg-sidebar-primary text-sidebar-primary-foreground'
                )}
              >
                <activeTeam.logo className='size-4' />
              </div>
              <div className='grid flex-1 text-start text-sm leading-tight'>
                <span className='truncate font-semibold'>
                  {activeTeam.name}
                </span>
                <span className='truncate text-xs'>{activeTeam.plan}</span>
              </div>
              <ChevronsUpDown className='ms-auto' />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
            align='start'
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className='text-xs text-muted-foreground'>
              Teams
            </DropdownMenuLabel>
            {teams.map((team) => (
              <DropdownMenuItem key={team.name} className='gap-2 p-2' asChild>
                <Link
                  to={team.basePath}
                  className='flex w-full items-center gap-2'
                  aria-current={team === activeTeam ? 'page' : undefined}
                >
                  <div
                    style={getAccentStyle(team.accentColor, {
                      colorVar: '--team-accent',
                      backgroundVar: '--team-accent-bg',
                      backgroundTint: 14,
                    })}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-sm border',
                      team.accentColor &&
                        'border-transparent bg-[var(--team-accent-bg)] text-[var(--team-accent)]'
                    )}
                  >
                    <team.logo className='size-4 shrink-0' />
                  </div>
                  <span>{team.name}</span>
                  {team === activeTeam ? (
                    <span className='ms-auto text-xs text-muted-foreground'>
                      Current
                    </span>
                  ) : null}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function activeTeamForPath(
  teams: TeamSwitcherProps['teams'],
  pathname: string
) {
  return (
    [...teams]
      .sort((left, right) => right.basePath.length - left.basePath.length)
      .find((team) =>
        team.basePath === '/'
          ? pathname === '/'
          : pathname === team.basePath ||
            pathname.startsWith(`${team.basePath}/`)
      ) ?? teams[0]
  )
}
