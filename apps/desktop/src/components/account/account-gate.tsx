import { useStore } from '@nanostores/react'
import { useEffect, type ReactNode } from 'react'
import { $account, initializeAccount } from '@/store/account'
import { AccountPanel } from './account-panel'

export function AccountGate({ children }: { children: ReactNode }) {
  const account = useStore($account)
  useEffect(() => { initializeAccount() }, [])
  if (!window.hermesDesktop?.account) return children
  if (!account) return <div className="p-8 text-sm text-muted-foreground">正在打开本地数据…</div>
  if (!account.welcomed) return <main className="h-screen overflow-auto bg-background p-8"><div className="mx-auto max-w-xl"><AccountPanel welcome /></div></main>
  return children
}
