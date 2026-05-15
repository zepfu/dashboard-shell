import type { CSSProperties } from 'react'
import { Link } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { getAccentStyle } from '@/lib/accent-color'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type TopNavProps = React.HTMLAttributes<HTMLElement> & {
  links: {
    title: string
    href: string
    isActive: boolean
    disabled?: boolean
    accentColor?: string
  }[]
}

function topNavAccentStyle(accentColor: string | undefined) {
  return getAccentStyle(accentColor, {
    colorVar: '--top-nav-accent',
    backgroundVar: '--top-nav-accent-bg',
    backgroundTint: 12,
  }) as CSSProperties | undefined
}

export function TopNav({ className, links, ...props }: TopNavProps) {
  return (
    <>
      <div className='lg:hidden'>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size='icon' variant='outline' className='md:size-7'>
              <Menu />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side='bottom' align='start'>
            {links.map(({ title, href, isActive, disabled, accentColor }) => (
              <DropdownMenuItem key={`${title}-${href}`} asChild>
                <Link
                  to={href}
                  style={topNavAccentStyle(accentColor)}
                  className={cn(
                    !isActive && 'text-muted-foreground',
                    accentColor &&
                      'hover:text-[var(--top-nav-accent)] focus:text-[var(--top-nav-accent)]',
                    isActive &&
                      accentColor &&
                      'bg-[var(--top-nav-accent-bg)] text-[var(--top-nav-accent)]'
                  )}
                  disabled={disabled}
                >
                  {title}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav
        className={cn(
          'hidden items-center space-x-4 lg:flex lg:space-x-4 xl:space-x-6',
          className
        )}
        {...props}
      >
        {links.map(({ title, href, isActive, disabled, accentColor }) => (
          <Link
            key={`${title}-${href}`}
            to={href}
            disabled={disabled}
            style={topNavAccentStyle(accentColor)}
            className={cn(
              'relative text-sm font-medium transition-colors hover:text-primary',
              !isActive && 'text-muted-foreground',
              accentColor && 'hover:text-[var(--top-nav-accent)]',
              isActive &&
                accentColor &&
                'text-[var(--top-nav-accent)] after:absolute after:start-0 after:-bottom-2 after:h-0.5 after:w-full after:rounded-full after:bg-[var(--top-nav-accent)]'
            )}
          >
            {title}
          </Link>
        ))}
      </nav>
    </>
  )
}
