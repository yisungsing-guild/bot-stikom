'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

function getAdminToken(): string | null {
  try {
    const t = window.localStorage.getItem('admin_token')
    return t && t.trim() ? t : null
  } catch {
    return null
  }
}

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const t = getAdminToken()
    router.replace(t ? '/dashboard' : '/login')
  }, [router])

  return null
}
