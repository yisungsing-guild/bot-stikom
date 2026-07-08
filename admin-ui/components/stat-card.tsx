import { Card } from '@/components/ui/card'
import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  change?: {
    value: number
    type: 'increase' | 'decrease'
  }
  trend?: 'up' | 'down' | 'neutral'
  className?: string
}

export function StatCard({
  title,
  value,
  icon: Icon,
  change,
  trend = 'neutral',
  className,
}: StatCardProps) {
  return (
    <Card className={cn('p-6', className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{title}</p>
          <div className="space-y-1">
            <p className="text-2xl font-bold">{value}</p>
            {change && (
              <p
                className={cn(
                  'text-xs font-medium',
                  change.type === 'increase'
                    ? 'text-green-500'
                    : 'text-red-500'
                )}
              >
                {change.type === 'increase' ? '↑' : '↓'}{' '}
                {change.value}% from last month
              </p>
            )}
          </div>
        </div>
        <div
          className={cn(
            'rounded-lg p-3',
            trend === 'up'
              ? 'bg-green-500/10 text-green-500'
              : trend === 'down'
                ? 'bg-red-500/10 text-red-500'
                : 'bg-blue-500/10 text-blue-500'
          )}
        >
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </Card>
  )
}
