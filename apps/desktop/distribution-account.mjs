import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { atomicWrite } from './storage-core.mjs'
import { accountPaths, normalizeSyncServer, readAccountConfig } from './account-core.mjs'

function parseWorker(result) {
  const line = String(result).trim().split(/\r?\n/).at(-1)
  let parsed
  try { parsed = JSON.parse(line) } catch { throw new Error('同步组件没有返回有效结果，请检查本地日志') }
  if (!parsed.ok) throw new Error(parsed.error || '同步失败')
  return parsed
}

export function prepareAccounts(storage, { python, source, directory }) {
  const configFile = path.join(storage.home, '.herness-account.json')
  const config = readAccountConfig(configFile)
  const selected = storage.external ? { home: storage.home, desktop: storage.desktop } : accountPaths(storage, config)
  fs.mkdirSync(selected.home, { recursive: true }); fs.mkdirSync(selected.desktop, { recursive: true })
  process.env.HERMES_HOME = selected.home
  process.env.HERMES_DESKTOP_USER_DATA_DIR = selected.desktop
  const worker = path.join(app.isPackaged ? process.resourcesPath : directory, 'sync-client', 'worker.py')
  const state = { storage, configFile, config, selected, python, source, worker, sync: { busy: false }, switching: false }
  if (config.account && !storage.external) {
    try {
      if (config.importGuest) {
        runSync(state, { command: 'import_guest', guest_home: storage.home })
        delete config.importGuest
        atomicWrite(configFile, JSON.stringify(config))
      }
      runSync(state, { command: 'apply' })
    } catch (error) { dialog.showErrorBox('云端记录暂未应用', error.message + '\n已有本地记录保留，可在账号设置中重试。') }
  }
  return state
}

function runSync(state, data) {
  const result = spawnSync(state.python, ['-X', 'utf8', state.worker], {
    input: JSON.stringify({ ...data, home: state.selected.home, source: state.source }),
    encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024,
  })
  if (result.error) throw new Error('本地同步组件启动失败：' + result.error.message)
  return parseWorker(result.stdout)
}

function runWorker(state, data) {
  return new Promise((resolve, reject) => {
    const child = spawn(state.python, ['-X', 'utf8', state.worker], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    const deadline = setTimeout(() => { child.kill(); reject(new Error('同步超时，未完成操作将在下次重试')) }, 180000)
    child.stdout.on('data', value => { if (output.length < 1024 * 1024) output += value.toString('utf8') })
    child.stderr.on('data', () => {}) // Provider/library diagnostics may contain local paths; never forward them to a remote service.
    child.on('error', error => { clearTimeout(deadline); reject(error) })
    child.on('close', () => { clearTimeout(deadline); try { resolve(parseWorker(output)) } catch (error) { reject(error) } })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ ...data, home: state.selected.home, source: state.source }))
  })
}

export function registerAccounts(state) {
  const active = new Map()
  let syncing = null
  const publish = () => {
    const value = info()
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('herness:account:changed', value)
    return value
  }
  const info = () => ({ welcomed: state.config.welcomed, endpoint: state.config.endpoint,
    user: state.config.account, external: state.storage.external, switching: state.switching, sync: state.sync })
  const credential = (mode, value) => {
    const result = spawnSync(state.python, ['-X', 'utf8', path.join(path.dirname(state.worker), 'credentials.py')], {
      input: JSON.stringify({ mode, value }), encoding: 'utf8', windowsHide: true, timeout: 10000,
    })
    if (result.error || result.status !== 0) throw new Error('Windows 登录凭据无法读取或保存，请在本机重新登录')
    return JSON.parse(result.stdout).value
  }
  const token = () => credential('decrypt', state.config.encryptedToken)
  async function api(route, { endpoint = state.config.endpoint, body, authenticated = true, method = 'POST' } = {}) {
    const url = normalizeSyncServer(endpoint) + '/v1' + route
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json',
      ...(authenticated ? { Authorization: 'Bearer ' + token() } : {}) },
      body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30000) })
    const result = await response.json()
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '请求失败，请检查填写的信息')
    return result
  }
  const anyWork = () => [...active.values()].some(count => count > 0)
  ipcMain.on('hermes:active-work', (event, work) => {
    if (!active.has(event.sender.id)) event.sender.once('destroyed', () => active.delete(event.sender.id))
    active.set(event.sender.id, Number(work?.count) || 0)
  })
  async function syncNow() {
    if (syncing) return syncing
    if (!state.config.account || state.storage.external || state.switching) return info()
    if (anyWork()) { state.sync = { ...state.sync, message: '对话进行中，结束后同步' }; return publish() }
    state.sync = { ...state.sync, busy: true, error: null }; publish()
    // Assign the in-flight promise before credential decoding can fail synchronously.
    syncing = Promise.resolve().then(async () => {
      try {
        const result = await runWorker(state, { command: 'sync', endpoint: state.config.endpoint, token: token() })
        state.sync = { ...result, busy: false, error: null }
      } catch (error) { state.sync = { ...state.sync, busy: false, error: error.message } }
      finally { syncing = null }
      return publish()
    })
    return syncing
  }
  async function switchAccount(next, message, beforeSwitch) {
    if (state.storage.external) throw new Error('请移除环境变量指定的数据目录后再登录账号')
    if (state.switching) throw new Error('正在切换账号，请等待程序重启')
    state.switching = true
    if (syncing) await syncing
    const result = await dialog.showMessageBox({ type: 'question', title: '切换账号需要重启',
      message, detail: '程序正常退出后切换独立数据空间。当前数据保留，不会上传给其他账号。',
      buttons: ['保存并重启', '取消'], defaultId: 1, cancelId: 1 })
    if (result.response !== 0) { state.switching = false; return publish() }
    if (beforeSwitch) await beforeSwitch()
    app.once('will-quit', () => {
      atomicWrite(state.configFile, JSON.stringify(next))
      delete process.env.HERMES_HOME; delete process.env.HERMES_DESKTOP_USER_DATA_DIR
      app.relaunch()
    })
    setTimeout(() => app.quit(), 200)
    return publish()
  }
  ipcMain.handle('herness:account:info', () => info())
  ipcMain.handle('herness:account:guest', () => {
    state.config.welcomed = true
    atomicWrite(state.configFile, JSON.stringify(state.config))
    return publish()
  })
  ipcMain.handle('herness:account:authenticate', async (_event, input) => {
    if (state.config.account && state.config.account.username.toLowerCase() !== String(input.username).toLowerCase()) {
      throw new Error('请先退出当前账号，再登录其他账号')
    }
    const endpoint = normalizeSyncServer(input.endpoint)
    const body = { username: input.username, password: input.password, device_id: state.config.deviceId,
      device_name: os.hostname(), ...(input.register ? { email: input.email } : {}) }
    const result = await api(input.register ? '/auth/register' : '/auth/login', { endpoint, body, authenticated: false })
    const next = { ...state.config, welcomed: true, endpoint, account: result.user,
      encryptedToken: credential('encrypt', result.token), importGuest: Boolean(input.importGuest && !state.config.account) }
    if (state.config.account?.id === result.user.id && state.config.endpoint === endpoint) {
      state.config = next; atomicWrite(state.configFile, JSON.stringify(next)); return publish()
    }
    return switchAccount(next, '登录成功。切换到 ' + result.user.username + ' 的数据空间？')
  })
  ipcMain.handle('herness:account:logout', async () => {
    // Local sign-out must remain available offline. Unrevoked remote tokens expire automatically.
    const result = await switchAccount({ welcomed: true, endpoint: state.config.endpoint, deviceId: state.config.deviceId, account: null },
      '退出登录并返回访客数据空间。离线退出不会立即撤销服务端令牌，可在其他设备中撤销登录。',
      async () => { try { await api('/auth/logout') } catch { /* Offline local sign-out is intentional. */ } })
    return result
  })
  ipcMain.handle('herness:account:sync', syncNow)
  ipcMain.handle('herness:account:apply', () => switchAccount(state.config, '应用已下载的云端记录并重启？'))
  ipcMain.handle('herness:account:devices', () => api('/devices', { method: 'GET' }))
  ipcMain.handle('herness:account:revoke', (_event, id) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('设备标识无效')
    return api('/devices/' + id, { method: 'DELETE' })
  })
  const timer = setInterval(() => void syncNow(), 60000)
  timer.unref()
  let waitingForSync = false
  app.on('before-quit', event => {
    if (event.defaultPrevented || !syncing) return
    event.preventDefault()
    if (!waitingForSync) {
      waitingForSync = true
      void syncing.finally(() => { waitingForSync = false; app.quit() })
    }
  })
  app.on('will-quit', () => clearInterval(timer))
  app.whenReady().then(() => { setTimeout(() => void syncNow(), 15000).unref() })
}
