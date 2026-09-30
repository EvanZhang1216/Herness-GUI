import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function normalizeSyncServer(value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash) throw new Error('服务器地址不能包含凭据或查询参数')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('公网同步必须使用 HTTPS；HTTP 仅限本机 SSH 隧道')
  return url.href.replace(/\/$/, '')
}

export function accountDirectoryKey(endpoint, userId) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('账号标识无效')
  return crypto.createHash('sha256').update(normalizeSyncServer(endpoint) + '\n' + userId).digest('hex')
}

export function accountPaths(storage, config) {
  if (!config.account) return { home: storage.home, desktop: storage.desktop }
  const key = accountDirectoryKey(config.endpoint, config.account.id)
  return { home: path.join(storage.home, 'accounts', key), desktop: path.join(storage.desktop, 'accounts', key) }
}

export function readAccountConfig(file) {
  if (!fs.existsSync(file)) return { welcomed: false, endpoint: '', deviceId: crypto.randomUUID(), account: null }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
