'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard,
  KeyRound,
  Menu,
  Settings,
  Megaphone,
  MessageCircle,
  History,
  Database,
  Phone,
  TestTube,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAdminIdentity, isAdminRole, onAdminTokenChanged, isSuperAdminRole } from '@/lib/adminIdentity'

const navItems = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Keyword',
    href: '/keyword',
    icon: KeyRound,
  },
  {
    title: 'Menu',
    href: '/menu',
    icon: Menu,
  },
  {
    title: 'Setting',
    href: '/setting',
    icon: Settings,
  },
  {
    title: 'Broadcast',
    href: '/broadcast',
    icon: Megaphone,
  },
  {
    title: 'Realtime Chat',
    href: '/live-chat',
    icon: MessageCircle,
  },
  {
    title: 'History',
    href: '/history',
    icon: History,
  },
  {
    title: 'Training Data',
    href: '/training-data',
    icon: Database,
  },
  {
    title: 'WhatsApp',
    href: '/whatsapp',
    icon: Phone,
  },
  {
    title: 'Testing',
    href: '/testing',
    icon: TestTube,
  },
]

export function Sidebar() {
  const pathname = usePathname()

  const [ident, setIdent] = useState(() => getAdminIdentity())

  useEffect(() => {
    return onAdminTokenChanged(() => {
      setIdent(getAdminIdentity())
    })
  }, [])

  const normalizedPathname = (() => {
    const p = String(pathname || '')
    return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
  })()

  const role = useMemo(() => {
    return ident && ident.role ? String(ident.role) : null
  }, [ident])

  const visibleNavItems = useMemo(() => {
    if (!role) return navItems
    if (isSuperAdminRole(role)) return navItems
    return navItems.filter((it) => it.href === '/dashboard' || it.href === '/training-data' || it.href === '/live-chat' || it.href === '/history')
  }, [role])

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-background pt-20">
      <div className="flex flex-col h-full px-4 py-6">
        <nav className="flex-1 space-y-2">
          {visibleNavItems.map((item) => {
            const Icon = item.icon
            const isActive = normalizedPathname === item.href
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span>{item.title}</span>
                {isActive && (
                  <ChevronRight className="absolute right-3 h-4 w-4" />
                )}
              </Link>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}

