'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getAdminIdentity, isSuperAdminRole } from '@/lib/adminIdentity'

const ALLOWED_NON_ADMIN_PATHS = new Set<string>(['/dashboard', '/training-data', '/live-chat', '/history'])

function normalizePath(pathname: string) {
  let p = String(pathname || '')
  if (!p) return ''
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

export function RoleGuard() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const p = normalizePath(pathname || '')
    if (!p || p === '/' || p.startsWith('/login')) return

    const ident = getAdminIdentity()
    const role = ident && ident.role ? String(ident.role) : null
    // username available if needed for additional per-user checks
    const username = ident && ident.username ? String(ident.username) : null
    if (!role) return

    const isFullAdmin = isSuperAdminRole(role)
    if (!isFullAdmin) {
      if (!ALLOWED_NON_ADMIN_PATHS.has(p)) {
        router.replace('/dashboard')
      }
    }
  }, [pathname, router])

  return null
}
