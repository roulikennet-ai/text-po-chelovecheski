/* ============================================================================
   account.ts — API-клиент учётной записи.

   Токен сессии хранится в localStorage (tph.v1.authToken).
   Тексты документов на сервер не отправляются.
   ========================================================================== */

/* ---------------------------- Публичные типы ---------------------------- */

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  consentAt: string | null;
  consentVersion: string | null;
  clientIds: string[];
}

export interface AccountStats {
  requests: number;
  ok: number;
  error: number;
  tokens: number;
  lastAt: string | null;
  byModel: Record<string, { requests: number; tokens: number }>;
}

export interface AccountMetaNotice {
  purpose: string;
  dataUse: string;
  recipient: string;
  retention: string;
}

export interface AccountMeta {
  ok: true;
  consentVersion: string;
  consentText: string;
  adminEmail: string | null;
  notice: AccountMetaNotice;
}

export interface AuthResponse {
  ok: true;
  token: string;
  expiresAt: number;
  user: AccountUser;
  stats: AccountStats;
}

export interface AccountError {
  ok: false;
  code: string;
  error: string;
  status?: number;
}

/* --------------------------- Ключи хранилища --------------------------- */

const KEY_TOKEN = 'tph.v1.authToken';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(KEY_TOKEN);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(KEY_TOKEN, token);
  } catch {
    /* ignore */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY_TOKEN);
  } catch {
    /* ignore */
  }
}

/* ----------------------------- API-клиент ----------------------------- */

const BASE = '/api/account';

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: AccountError = {
      ok: false,
      code: body?.code || 'unknown',
      error: body?.error || `Сервер ответил ${res.status}.`,
      status: res.status,
    };
    throw err;
  }
  return body as T;
}

export async function getMeta(): Promise<AccountMeta> {
  return api<AccountMeta>('/meta', { method: 'GET' });
}

export async function register(payload: {
  name: string;
  email: string;
  password: string;
  consent: boolean;
  consentVersion: string;
  clientId?: string;
}): Promise<AuthResponse> {
  return api<AuthResponse>('/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function login(payload: {
  email: string;
  password: string;
  clientId?: string;
}): Promise<AuthResponse> {
  return api<AuthResponse>('/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function logout(token: string): Promise<{ ok: true }> {
  return api<{ ok: true }>('/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function me(token: string): Promise<{ ok: true; user: AccountUser; stats: AccountStats }> {
  return api<{ ok: true; user: AccountUser; stats: AccountStats }>('/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateProfile(
  token: string,
  patch: { name?: string; clientId?: string },
): Promise<{ ok: true; user: AccountUser; stats: AccountStats }> {
  return api<{ ok: true; user: AccountUser; stats: AccountStats }>('/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  });
}

export async function deleteAccount(token: string, password: string): Promise<{ ok: true }> {
  return api<{ ok: true }>('/delete', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
}
