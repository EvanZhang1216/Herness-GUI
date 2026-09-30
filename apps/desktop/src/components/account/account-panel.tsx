import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { $account, $accountError, initializeAccount } from '@/store/account'

export function AccountPanel({ welcome = false }: { welcome?: boolean }) {
  const account = useStore($account)
  const loadError = useStore($accountError)
  const [register, setRegister] = useState(false)
  const [endpoint, setEndpoint] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [importGuest, setImportGuest] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reauthenticate, setReauthenticate] = useState(false)
  const [devices, setDevices] = useState<Array<{ id: string; name: string; last_seen_at: string; revoked_at: string | null }>>([])
  useEffect(() => { initializeAccount() }, [])
  useEffect(() => {
    setEndpoint(account?.endpoint ?? '')
    setUsername(account?.user?.username ?? '')
  }, [account?.endpoint, account?.user?.username])
  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  async function authenticate() {
    try {
      const value = await window.hermesDesktop.account.authenticate({ endpoint, username, password, email, register, importGuest })
      $account.set(value)
      setReauthenticate(false)
    } finally { setPassword('') }
  }
  const blocked = busy || account?.switching
  return <section className="space-y-4" data-testid="account-panel">
    <h2 className="text-lg font-semibold">{welcome ? '欢迎使用 Herness GUI' : '账号与云端同步'}</h2>
    <p className="text-sm text-muted-foreground">不登录也可使用本地聊天。登录后同步此账号的聊天和内嵌附件，模型 API Key 保留在本机。首次登录会切换到独立数据空间。</p>
    <p className="text-sm text-muted-foreground">云端会话自创建起保留 180 天，到期整段删除，包含上下文和关联附件。外部项目文件、运行中的工具和远程主机不随聊天同步。</p>
    {account?.user && <>
      <p className="text-sm">已登录：<strong>{account.user.username}</strong> · {account.user.email}（未验证）</p>
      <p className="text-xs break-all text-muted-foreground">服务器：{account.endpoint}</p>
      <p role="status" className="text-sm">{account.sync.busy ? '正在同步…' : account.sync.error || account.sync.message || (account.sync.last_sync_at ? `上次同步：${new Date(account.sync.last_sync_at * 1000).toLocaleString()}` : '等待同步')}</p>
      {!!account.sync.conflicts && <p className="text-sm">检测到 {account.sync.conflicts} 个并行修改，已保留为冲突分支。应用云端更新后可查看两个版本。</p>}
      {account.sync.used_bytes !== undefined && <p className="text-xs text-muted-foreground">云端空间：{(account.sync.used_bytes / 1048576).toFixed(1)} / {((account.sync.quota_bytes ?? 0) / 1048576).toFixed(0)} MB</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={blocked || account.sync.busy} onClick={() => void perform(() => window.hermesDesktop.account.sync())}>立即同步</Button>
        {!!account.sync.pending_downloads && <Button size="sm" disabled={blocked} onClick={() => void perform(() => window.hermesDesktop.account.apply())}>应用 {account.sync.pending_downloads} 项更新并重启</Button>}
        <Button size="sm" variant="text" disabled={blocked} onClick={() => setReauthenticate(!reauthenticate)}>重新登录</Button>
        <Button size="sm" variant="text" disabled={blocked} onClick={() => void perform(() => window.hermesDesktop.account.logout())}>退出登录</Button>
        <Button size="sm" variant="text" disabled={blocked} onClick={() => void perform(async () => setDevices(await window.hermesDesktop.account.devices()))}>登录设备</Button>
      </div>
      {devices.map(device => <div key={device.id} className="flex items-center justify-between gap-2 text-sm">
        <span>{device.name} · {device.revoked_at ? '已撤销' : new Date(device.last_seen_at).toLocaleString()}</span>
        {!device.revoked_at && <Button size="sm" variant="text" onClick={() => void perform(async () => { await window.hermesDesktop.account.revoke(device.id); setDevices(await window.hermesDesktop.account.devices()) })}>撤销登录</Button>}
      </div>)}
    </>}
    {(!account?.user || reauthenticate) && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void perform(authenticate) }}>
      <label className="block text-sm">同步服务器地址<Input aria-label="同步服务器地址" className="mt-1" placeholder="https://sync.example.com" value={endpoint} onChange={event => setEndpoint(event.target.value)} disabled={blocked || !!account?.user} required /></label>
      <p className="text-xs text-muted-foreground">尚无默认公网服务。仅开发联调可使用 http://127.0.0.1 的 SSH 隧道地址。</p>
      <label className="block text-sm">用户名<Input aria-label="用户名" className="mt-1" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={32} disabled={blocked || !!account?.user} required /></label>
      {register && <label className="block text-sm">邮箱<Input aria-label="邮箱" className="mt-1" type="email" value={email} onChange={event => setEmail(event.target.value)} disabled={blocked} required /></label>}
      <label className="block text-sm">密码<Input aria-label="密码" className="mt-1" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={10} maxLength={128} disabled={blocked} required /></label>
      {register && <p className="text-xs text-muted-foreground">邮箱仅登记，暂不发送验证码，也不支持邮箱找回密码。密码至少 10 位。</p>}
      {!account?.user && <label className="flex gap-2 text-sm"><input type="checkbox" checked={importGuest} onChange={event => setImportGuest(event.target.checked)} disabled={blocked} />将本机访客聊天导入这个账号并同步（不包含 API Key）</label>}
      <div className="flex gap-3">
        <Button size="sm" type="submit" disabled={blocked || account?.external}>{register ? '注册账号' : '登录'}</Button>
        {!account?.user && <Button size="sm" variant="text" type="button" disabled={blocked} onClick={() => setRegister(!register)}>{register ? '已有账号，去登录' : '注册新账号'}</Button>}
      </div>
    </form>}
    {account?.external && <p className="text-sm text-muted-foreground">当前环境变量固定了数据目录，请移除覆盖配置后再登录。免登录模式仍可用。</p>}
    {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}
    {account?.switching && <p role="status" className="text-sm">已安排切换，请允许程序正常退出并重启。</p>}
    {welcome && <Button variant="text" onClick={() => void perform(() => window.hermesDesktop.account.guest())}>暂不登录，使用本地模式</Button>}
  </section>
}
