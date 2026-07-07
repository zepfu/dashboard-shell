import { type SVGProps } from 'react'
import { cn } from '@/lib/utils'

export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      id='dashboard-shell-logo'
      viewBox='0 0 24 24'
      xmlns='http://www.w3.org/2000/svg'
      height='24'
      width='24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={cn('size-6', className)}
      {...props}
    >
      <title>Dashboard Shell</title>
      <rect
        x='1'
        y='1'
        width='22'
        height='22'
        rx='4'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path d='M1 10h22' stroke='currentColor' strokeWidth='2' />
      <path d='M12 1v22' stroke='currentColor' strokeWidth='2' />
      <rect x='4' y='4' width='4' height='4' rx='1' fill='currentColor' />
      <rect x='16' y='4' width='4' height='4' rx='1' fill='currentColor' />
      <rect x='16' y='16' width='4' height='4' rx='1' fill='currentColor' />
    </svg>
  )
}
