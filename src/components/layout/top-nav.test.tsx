import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { TopNav } from './top-nav'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode
    to: string
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

describe('TopNav mobile menu', () => {
  test('names the mobile navigation button without dropping accent classes', () => {
    render(
      <TopNav
        links={[
          {
            title: 'Overview',
            href: '/overview',
            isActive: true,
            accentColor: 'hsl(220 70% 50%)',
          },
        ]}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Toggle navigation menu' })
    ).toBeInTheDocument()
    const desktopLink = screen.getByRole('link', { name: 'Overview' })
    expect(desktopLink.className).toContain('--top-nav-accent')
  })
})
