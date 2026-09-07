'use client'

import { Bell, Moon, Search, Sun, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { clearAdminToken, getAdminIdentity, initialsFromName, onAdminTokenChanged } from '@/lib/adminIdentity'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useEffect, useMemo, useState } from 'react'

export function Header() {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()

  const isDark = resolvedTheme === 'dark'

  const [ident, setIdent] = useState(() => getAdminIdentity())

  useEffect(() => {
    // Keep header identity in sync with token changes.
    return onAdminTokenChanged(() => {
      setIdent(getAdminIdentity())
    })
  }, [])

  const displayName = useMemo(() => {
    return (ident && (ident.displayName || ident.username))
      ? String(ident.displayName || ident.username)
      : 'User'
  }, [ident])

  const role = useMemo(() => {
    return ident && ident.role ? String(ident.role) : null
  }, [ident])

  const avatarText = useMemo(() => initialsFromName(displayName), [displayName])

  function handleLogout() {
    clearAdminToken()
    router.push('/login')
  }

  return (
    <header className="fixed top-0 right-0 left-64 z-40 border-b border-border/80 bg-background/80 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between px-6 gap-4">
        <div className="flex flex-1 items-center gap-4">
          <div className="relative hidden md:flex flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari..."
              className="pl-9 bg-muted/50 border border-border/60 rounded-xl focus-visible:ring-1 focus-visible:ring-primary/40 focus:bg-background transition-all"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative rounded-xl hover:bg-muted/60"
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <span className="text-muted-foreground text-xs">No notifications yet</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  router.push('/history')
                }}
              >
                <span>Open History</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  router.push('/whatsapp')
                }}
              >
                <span>Open WhatsApp</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full ring-2 ring-primary/20 hover:ring-primary/40 transition-all"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-xs">
                    {avatarText}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-semibold leading-none">{displayName}</p>
                  <p className="text-xs leading-none text-muted-foreground font-mono">
                    {role ? `Role: ${role}` : ' '}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setTheme(isDark ? 'light' : 'dark')
                }}
              >
                {isDark ? (
                  <Sun className="mr-2 h-4 w-4" />
                ) : (
                  <Moon className="mr-2 h-4 w-4" />
                )}
                <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  handleLogout()
                }}
              >
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
