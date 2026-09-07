import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StatCardVariant =
  | 'blue'
  | 'emerald'
  | 'sky'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'fuchsia'

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  variant?: StatCardVariant
  change?: {
    value: number
    type: 'increase' | 'decrease'
  }
  trend?: 'up' | 'down' | 'neutral'
  className?: string
}

const variantStyles: Record<
  StatCardVariant,
  {
    iconBg: string
    iconColor: string
    borderHover: string
    glow: string
    accent: string
  }
> = {
  blue: {
    iconBg: 'bg-blue-500/15 border-blue-500/25',
    iconColor: 'text-blue-400',
    borderHover: 'hover:border-blue-500/40',
    glow: 'hover:shadow-blue-500/10',
    accent: 'bg-gradient-to-r from-blue-500 to-indigo-500',
  },
  emerald: {
    iconBg: 'bg-emerald-500/15 border-emerald-500/25',
    iconColor: 'text-emerald-400',
    borderHover: 'hover:border-emerald-500/40',
    glow: 'hover:shadow-emerald-500/10',
    accent: 'bg-gradient-to-r from-emerald-500 to-teal-500',
  },
  sky: {
    iconBg: 'bg-sky-500/15 border-sky-500/25',
    iconColor: 'text-sky-400',
    borderHover: 'hover:border-sky-500/40',
    glow: 'hover:shadow-sky-500/10',
    accent: 'bg-gradient-to-r from-sky-500 to-cyan-500',
  },
  violet: {
    iconBg: 'bg-violet-500/15 border-violet-500/25',
    iconColor: 'text-violet-400',
    borderHover: 'hover:border-violet-500/40',
    glow: 'hover:shadow-violet-500/10',
    accent: 'bg-gradient-to-r from-violet-500 to-purple-500',
  },
  amber: {
    iconBg: 'bg-amber-500/15 border-amber-500/25',
    iconColor: 'text-amber-400',
    borderHover: 'hover:border-amber-500/40',
    glow: 'hover:shadow-amber-500/10',
    accent: 'bg-gradient-to-r from-amber-500 to-orange-500',
  },
  rose: {
    iconBg: 'bg-rose-500/15 border-rose-500/25',
    iconColor: 'text-rose-400',
    borderHover: 'hover:border-rose-500/40',
    glow: 'hover:shadow-rose-500/10',
    accent: 'bg-gradient-to-r from-rose-500 to-red-500',
  },
  fuchsia: {
    iconBg: 'bg-fuchsia-500/15 border-fuchsia-500/25',
    iconColor: 'text-fuchsia-400',
    borderHover: 'hover:border-fuchsia-500/40',
    glow: 'hover:shadow-fuchsia-500/10',
    accent: 'bg-gradient-to-r from-fuchsia-500 to-pink-500',
  },
}

export function StatCard({
  title,
  value,
  icon: Icon,
  variant = 'blue',
  change,
  trend = 'neutral',
  className,
}: StatCardProps) {
  const v = variantStyles[variant] || variantStyles.blue

  return (
    <div
      className={cn(
        'group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card/70 p-4 transition-all duration-300 backdrop-blur-md hover:-translate-y-0.5 hover:shadow-lg',
        v.borderHover,
        v.glow,
        className
      )}
    >
      {/* Subtle top indicator bar */}
      <div className={cn('absolute top-0 left-0 right-0 h-[2px] opacity-85', v.accent)} />

      <div className="flex items-center justify-between gap-2 min-w-0">
        <p
          className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate"
          title={title}
        >
          {title}
        </p>
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-transform duration-300 group-hover:scale-110',
            v.iconBg,
            v.iconColor
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-3">
        <p className="text-xl sm:text-2xl xl:text-[1.65rem] font-bold tracking-tight text-foreground truncate">
          {value}
        </p>

        {change && (
          <p
            className={cn(
              'mt-1 text-xs font-medium flex items-center gap-1',
              change.type === 'increase' ? 'text-emerald-400' : 'text-rose-400'
            )}
          >
            <span>{change.type === 'increase' ? '↑' : '↓'}</span>
            <span>{change.value}% from last month</span>
          </p>
        )}
      </div>
    </div>
  )
}
