'use client';

const TOKEN_STORAGE_KEY = 'aegis_oauth_session_token';

export function getStoredSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restrictions
  }
}

export async function aegisFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (typeof window === 'undefined') {
    return fetch(input, init);
  }

  const baseFetch = window.fetch.bind(window);
  const urlStr =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

  const isSameOriginApi =
    urlStr.startsWith('/api/') || urlStr.startsWith(`${window.location.origin}/api/`);

  if (!isSameOriginApi) {
    return baseFetch(input, init);
  }

  const token = getStoredSessionToken();
  if (!token) {
    return baseFetch(input, init);
  }

  const headers = new Headers(
    init?.headers || (input instanceof Request ? input.headers : undefined)
  );
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return baseFetch(input, { ...init, headers });
}

export async function exchangeOAuthCodeForSession(exchangeCode: string): Promise<{
  ok: boolean;
  sessionToken?: string;
  message?: string;
}> {
  try {
    const res = await aegisFetch('/api/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exchangeCode }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      sessionToken?: string;
      message?: string;
    };
    if (!res.ok) {
      return { ok: false, message: data.message || 'OAuth2 session exchange failed.' };
    }
    if (data.sessionToken) {
      setStoredSessionToken(data.sessionToken);
    }
    return { ok: Boolean(data.ok), sessionToken: data.sessionToken, message: data.message };
  } catch {
    return { ok: false, message: 'Network error during OAuth2 session exchange.' };
  }
}

function canSafelyOverrideWindowFetch(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const ownDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
    if (ownDesc) {
      if (ownDesc.writable === true) return true;
      if (ownDesc.set) return true;
      return Boolean(ownDesc.configurable);
    }
    const proto = Object.getPrototypeOf(window);
    const protoDesc = proto ? Object.getOwnPropertyDescriptor(proto, 'fetch') : undefined;
    if (protoDesc) {
      if (protoDesc.writable === true || typeof protoDesc.set === 'function') return true;
      return Boolean(protoDesc.configurable);
    }
    return Object.isExtensible(window);
  } catch {
    return false;
  }
}

/**
 * Installs a defensive fetch bridge ONLY if `window.fetch` is writable or configurable.
 * On browsers/WebViews where `window.fetch` is a readonly/getter-only property
 * (e.g., Safari/WebKit hardened contexts), gracefully skips patching so no
 * "Attempted to assign to readonly property" TypeError can occur—all app API calls
 * already use `aegisFetch` directly for Bearer token fallback.
 */
export function installAegisApiFetchBridge(): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => {};
  }

  if (!canSafelyOverrideWindowFetch()) {
    return () => {};
  }

  const ownDescriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
  const originalFetch = window.fetch.bind(window);

  const bridgedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    const isSameOriginApi =
      urlStr.startsWith('/api/') || urlStr.startsWith(`${window.location.origin}/api/`);

    if (!isSameOriginApi) {
      return originalFetch(input, init);
    }

    const token = getStoredSessionToken();
    if (!token) {
      return originalFetch(input, init);
    }

    const headers = new Headers(
      init?.headers || (input instanceof Request ? input.headers : undefined)
    );
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return originalFetch(input, { ...init, headers });
  };

  try {
    if (ownDescriptor && ownDescriptor.writable !== true && ownDescriptor.configurable) {
      Object.defineProperty(window, 'fetch', {
        value: bridgedFetch,
        writable: true,
        configurable: true,
      });
    } else if (!ownDescriptor || ownDescriptor.writable === true) {
      window.fetch = bridgedFetch;
    }
  } catch {
    return () => {};
  }

  return () => {
    try {
      if (ownDescriptor && ownDescriptor.configurable) {
        Object.defineProperty(window, 'fetch', ownDescriptor);
      } else {
        const currentDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
        if (!currentDesc || currentDesc.writable === true || typeof currentDesc.set === 'function') {
          window.fetch = originalFetch;
        }
      }
    } catch {
      // Ignore readonly restoration failure on teardown
    }
  };
}

