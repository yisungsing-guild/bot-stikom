'use client'

const ADMIN_TOKEN_STORAGE_KEY = 'admin_token'

// Fired when the token is changed within the same tab.
const ADMIN_TOKEN_CHANGED_EVENT = 'admin_token_changed'

export type AdminIdentity = {
  adminId?: string | null
  username?: string | null
  displayName?: string | null
  role?: string | null
  type?: string | null
}

function base64UrlDecode(input: string) {
  const s = String(input || '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4
  const padded = pad ? s + '='.repeat(4 - pad) : s
  return atob(padded)
}

export function getAdminToken(): string | null {
  try {
    const t = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)
    return t && t.trim() ? t : null
  } catch {
    return null
  }
}

export function setAdminToken(token: string) {
  try {
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, String(token || ''))
  } catch {
    // ignore
  }

  try {
    window.dispatchEvent(new Event(ADMIN_TOKEN_CHANGED_EVENT))
  } catch {
    // ignore
  }
}

export function clearAdminToken() {
  try {
    window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
  } catch {
    // ignore
  }

  try {
    window.dispatchEvent(new Event(ADMIN_TOKEN_CHANGED_EVENT))
  } catch {
    // ignore
  }
}

export function onAdminTokenChanged(listener: () => void) {
  try {
    window.addEventListener(ADMIN_TOKEN_CHANGED_EVENT, listener)
    return () => {
      try {
        window.removeEventListener(ADMIN_TOKEN_CHANGED_EVENT, listener)
      } catch {
        // ignore
      }
    }
  } catch {
    return () => {}
  }
}

export function decodeAdminIdentityFromToken(token: string | null): AdminIdentity | null {
  try {
    if (!token) return null
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payloadJson = base64UrlDecode(parts[1])
    const payload = JSON.parse(payloadJson)
    if (!payload || typeof payload !== 'object') return null

    return {
      adminId: payload.adminId ?? null,
      username: payload.username ?? null,
      displayName: payload.displayName ?? null,
      role: payload.role ?? null,
      type: payload.type ?? null,
    }
  } catch {
    return null
  }
}

export function getAdminIdentity(): AdminIdentity | null {
  return decodeAdminIdentityFromToken(getAdminToken())
}

export function isAdminRole(role: string | null | undefined) {
  const r = String(role || '').toLowerCase().trim()
  return r === 'admin' || r === 'superadmin'
}

export function isSuperAdminRole(role: string | null | undefined) {
  const r = String(role || '').toLowerCase().trim()
  return r === 'superadmin'
}

export function initialsFromName(name: string | null | undefined) {
  const n = String(name || '').trim()
  if (!n) return 'U'
  const parts = n.split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0] || 'U'
  const b = (parts.length > 1 ? parts[parts.length - 1]?.[0] : parts[0]?.[1]) || ''
  return (a + b).toUpperCase()
}
