import { atom } from 'nanostores'

export interface AccountState {
  welcomed: boolean
  endpoint: string
  user: { id: string; username: string; email: string; email_verified_at: string | null } | null
  external: boolean
  switching: boolean
  sync: { busy?: boolean; error?: string | null; message?: string; pending_downloads?: number; conflicts?: number;
    last_sync_at?: number; used_bytes?: number; quota_bytes?: number; retention_days?: number }
}

export interface AccountCredentials {
  endpoint: string
  username: string
  password: string
  email: string
  register: boolean
  importGuest: boolean
}

export const $account = atom<AccountState | null>(null)
export const $accountError = atom<string | null>(null)
let initialized = false
export function initializeAccount() {
  if (initialized) return
  initialized = true
  if (!window.hermesDesktop?.account) return
  window.hermesDesktop.account.onChanged(value => $account.set(value))
  void window.hermesDesktop.account.info().then(value => $account.set(value)).catch(error => $accountError.set(String(error)))
}
