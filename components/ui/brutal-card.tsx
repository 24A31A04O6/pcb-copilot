"use client"

import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type BrutalCardProps = {
  children: ReactNode
  className?: string
  variant?: 'default' | 'cyan' | 'black' | 'white'
  shadow?: 'sm' | 'default' | 'lg' | 'none' | 'cyan'
  hover?: boolean
  padding?: 'none' | 'sm' | 'default' | 'lg'
}

export function BrutalCard({
  children,
  className,
  variant = 'default',
  shadow = 'default',
  hover = false,
  padding = 'default',
}: BrutalCardProps) {
  const variantStyles = {
    default: 'bg-white text-black border-black',
    cyan: 'bg-[#00E5FF] text-black border-black',
    black: 'bg-black text-white border-black',
    white: 'bg-white text-black border-black',
  }

  const shadowStyles = {
    none: '',
    sm: 'shadow-[2px_2px_0px_0px_black]',
    default: 'shadow-[4px_4px_0px_0px_black]',
    lg: 'shadow-[8px_8px_0px_0px_black]',
    cyan: 'shadow-[4px_4px_0px_0px_#00E5FF]',
  }

  const paddingStyles = {
    none: 'p-0',
    sm: 'p-3',
    default: 'p-4',
    lg: 'p-6',
  }

  return (
    <div
      className={cn(
        'border-[3px] transition-all',
        variantStyles[variant],
        shadowStyles[shadow],
        paddingStyles[padding],
        hover && 'hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_black]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function BrutalCardHeader({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('border-b-[3px] border-black -m-4 mb-4 p-4 bg-zinc-50', className)}>
      {children}
    </div>
  )
}

export function BrutalCardTitle({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <h3 className={cn('font-black text-sm uppercase tracking-widest', className)}>{children}</h3>
  )
}
