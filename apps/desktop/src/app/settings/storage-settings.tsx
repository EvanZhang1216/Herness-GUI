import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FolderOpen } from '@/lib/icons'
import { SectionHeading } from './primitives'

export function StorageSettings() {
  const [info, setInfo] = useState<Awaited<ReturnType<Window['hermesDesktop']['storage']['info']>> | null>(null)
  const [target, setTarget] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void window.hermesDesktop.storage.info().then(setInfo).catch(error => setMessage(error.message)) }, [])
  async function choose() {
    try { const directory = await window.hermesDesktop.storage.choose(); if (directory) setTarget(directory) }
    catch (error) { setMessage(String(error)) }
  }
  async function migrate() {
    setBusy(true); setMessage('')
    try {
      const result = await window.hermesDesktop.storage.migrate(target)
      if (result.scheduled) setMessage('已安排迁移。请允许程序退出；若取消退出，将在下次正常退出后迁移并重启。')
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3" data-testid="storage-settings">
    <SectionHeading title="用户数据位置" icon={FolderOpen} />
    <p className="text-sm text-muted-foreground">迁移聊天记录、模型配置与密钥、记忆、技能和桌面设置。退出后复制校验，原目录保留备份。外部项目文件和远程数据不移动。</p>
    <p className="break-all text-xs">Hermes：{info?.home ?? '读取中…'}<br />桌面设置：{info?.desktop ?? '读取中…'}</p>
    {info?.external && <p className="text-sm text-muted-foreground">当前由环境变量指定目录，移除覆盖配置后可迁移。</p>}
    <label className="block text-sm">新数据目录（空目录）
      <Input aria-label="新数据目录" className="mt-2 w-full" value={target} onChange={event => setTarget(event.target.value)} disabled={busy || info?.external} />
    </label>
    <div className="flex gap-3">
      <Button size="sm" variant="text" onClick={() => void choose()} disabled={busy || info?.external}>浏览…</Button>
      <Button size="sm" onClick={() => void migrate()} disabled={busy || !target || !info || info.external}>迁移并重启</Button>
    </div>
    {message && <p role="status" className="text-sm break-all">{message}</p>}
  </section>
}
