type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function getAdminToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const t = window.localStorage.getItem('admin_token');
    return t && t.trim() ? t : null;
  } catch {
    return null;
  }
}

function getAdminApiBase(): string {
  try {
    if (typeof window === 'undefined') return '';
    const raw = window.localStorage.getItem('admin_api_base');
    const base = raw ? String(raw).trim().replace(/\/$/, '') : '';
    if (!base) return '';

    try {
      const parsed = new URL(base);
      const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (isLocalHost && parsed.protocol === 'https:') {
        parsed.protocol = 'http:';
        return parsed.toString().replace(/\/$/, '');
      }
    } catch {
      // ignore invalid URL and fall back to stored value
    }

    return base;
  } catch {
    return '';
  }
}

export class AdminApiError extends Error {
  status: number;
  bodyText?: string;

  constructor(message: string, status: number, bodyText?: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.bodyText = bodyText;
  }
}

export async function adminFetchRaw(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = getAdminToken();
  const apiBase = getAdminApiBase();

  const headers = new Headers(init.headers || undefined);
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

  const url = (() => {
    if (!apiBase) return path;
    if (/^https?:\/\//i.test(path)) return path;
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${apiBase}${p}`;
  })();

  const res = await fetch(url, {
    ...init,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('admin_token');
      } catch {
        // ignore
      }
      try {
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      } catch {
        // ignore
      }
    }

    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }

    throw new AdminApiError(`Request failed: ${res.status} ${res.statusText}`, res.status, bodyText);
  }

  return res;
}

export async function adminFetchJson<T = JsonValue>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = getAdminToken();
  const apiBase = getAdminApiBase();

  const headers = new Headers(init.headers || undefined);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  // Only set JSON Content-Type when we're actually sending JSON.
  // For FormData uploads, browser must set multipart boundary.
  const bodyAny: any = init.body as any;
  const isFormData = typeof FormData !== 'undefined' && bodyAny instanceof FormData;
  if (!headers.has('Content-Type') && init.body && !isFormData) headers.set('Content-Type', 'application/json');
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

  const url = (() => {
    if (!apiBase) return path;
    // If a full URL is provided, keep it as-is.
    if (/^https?:\/\//i.test(path)) return path;
    // Ensure we build a valid URL whether `path` starts with '/' or not.
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${apiBase}${p}`;
  })();

  const res = await fetch(url, {
    ...init,
    headers,
  });

  if (!res.ok) {
    // If token is missing/expired, force user to login.
    // NOTE: 403 can also mean RBAC forbidden; do not logout on 403.
    if (res.status === 401 && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('admin_token');
      } catch {
        // ignore
      }
      try {
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      } catch {
        // ignore
      }
    }

    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }

    throw new AdminApiError(`Request failed: ${res.status} ${res.statusText}`, res.status, bodyText);
  }

  // Ensure we actually received JSON.
  // Common production misconfig: reverse-proxy serves HTML for /admin/* routes.
  // That would otherwise throw later or silently break UIs.
  const contentType = res.headers.get('content-type') || '';
  if (!/application\/json/i.test(contentType)) {
    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch {
      bodyText = undefined;
    }
    throw new AdminApiError(
      `Expected JSON but received '${contentType || 'unknown'}'`,
      res.status,
      bodyText
    );
  }

  try {
    return (await res.json()) as T;
  } catch (e) {
    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch {
      bodyText = undefined;
    }
    throw new AdminApiError('Failed to parse JSON response', res.status, bodyText);
  }
}
