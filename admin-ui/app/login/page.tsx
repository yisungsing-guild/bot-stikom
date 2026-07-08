'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setAdminToken } from '@/lib/adminIdentity'

function getAdminToken(): string | null {
  try {
    const t = window.localStorage.getItem('admin_token')
    return t && t.trim() ? t : null
  } catch {
    return null
  }
}

type LoginResponse =
  | { ok: true; token: string; refreshToken?: string; expiresIn?: string }
  | { ok?: false; error?: string }

function getAdminApiBase(): string {
  try {
    const raw = window.localStorage.getItem('admin_api_base')
    const base = raw ? String(raw).trim().replace(/\/$/, '') : ''
    if (!base) return ''

    try {
      const parsed = new URL(base)
      const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      if (isLocalHost && parsed.protocol === 'https:') {
        parsed.protocol = 'http:'
        return parsed.toString().replace(/\/$/, '')
      }
    } catch {
      // ignore invalid URL and use stored value as-is
    }

    return base
  } catch {
    return ''
  }
}

export default function LoginPage() {
  const router = useRouter()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(() => {
    return username.trim().length > 0 && password.length > 0 && !isSubmitting
  }, [username, password, isSubmitting])

  useEffect(() => {
    // If already logged in, skip login screen.
    const t = getAdminToken()
    if (t) router.replace('/dashboard')
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setIsSubmitting(true)
    setError(null)

    try {
      const apiBase = getAdminApiBase()
      const url = apiBase ? `${apiBase}/auth/login` : '/auth/login'

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ username, password }),
      })

      const data: LoginResponse = await res.json().catch(() => ({} as any))

      if (!res.ok || !('token' in data) || !data.token) {
        const apiMsg = ('error' in data && data.error) ? String(data.error) : ''
        const msg = apiMsg || (res.status === 401 ? 'Username atau password salah' : `Login gagal (${res.status})`)
        setError(`${msg}${apiBase ? `\n\nAPI: ${apiBase}` : ''}`)
        return
      }

      try {
        setAdminToken(data.token)
      } catch {
        // ignore
      }

      router.replace('/dashboard')
    } catch (err: any) {
      const apiBase = getAdminApiBase()
      const msg = err?.message || 'Login failed'
      setError(`${msg}${apiBase ? `\n\nAPI: ${apiBase}` : ''}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Admin Login</CardTitle>
          <CardDescription>Masukkan username dan password admin.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="mis: admin"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="password"
              />
            </div>

            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
                {error}
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {isSubmitting ? 'Logging in...' : 'Login'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
