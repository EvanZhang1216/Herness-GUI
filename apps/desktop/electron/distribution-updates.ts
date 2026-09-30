import { app, BrowserWindow, ipcMain } from 'electron'
import updaterPackage from 'electron-updater'

const { autoUpdater } = updaterPackage
const feed = { provider: 'github' as const, owner: 'EvanZhang1216', repo: 'Herness-GUI' }

export function registerDistributionUpdates({ source }: { source: string }) {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.setFeedURL(feed)
  let checking: Promise<any> | null = null
  let applying = false
  const publish = (stage: string, message: string, percent: number | null = null) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('hermes:updates:progress', { stage, message, percent, at: Date.now() })
    }
  }
  // Handled errors are returned through IPC; an EventEmitter error still needs a listener.
  autoUpdater.on('error', error => publish('error', error.message))
  autoUpdater.on('download-progress', progress => publish('fetch', '正在下载经过适配的完整安装包…', progress.percent))
  const check = () => {
    checking ??= autoUpdater.checkForUpdates().then(result => ({
      supported: true,
      branch: 'Herness-GUI releases',
      currentSha: app.getVersion(),
      currentVersion: app.getVersion(),
      targetSha: result?.updateInfo.version,
      updateAvailable: result?.isUpdateAvailable ?? false,
      behind: result?.isUpdateAvailable ? null : 0,
      fetchedAt: Date.now(),
      commits: [],
    })).catch(error => ({
      supported: true, error: 'check-failed', message: error.message, fetchedAt: Date.now(),
    })).finally(() => { checking = null })
    return checking
  }
  const replace = (channel: string, handler: (...args: any[]) => any) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
  replace('hermes:updates:check', check)
  replace('hermes:updates:branch:get', () => ({ branch: 'Herness-GUI releases' }))
  replace('hermes:updates:branch:set', () => { throw new Error('此发行版只使用经过适配的 GitHub Release。') })
  replace('hermes:connections:update-all', () => {
    throw new Error('Herness GUI 请从设置 → 关于更新完整发行版；远程后端由其维护者管理。')
  })
  replace('hermes:version', () => ({
    appVersion: app.getVersion(), electronVersion: process.versions.electron,
    nodeVersion: process.versions.node, platform: process.platform, hermesRoot: source,
    bundleOutOfSync: false, bundleSwapPending: false,
  }))
  replace('hermes:updates:apply', async () => {
    if (applying) return { ok: false, error: 'busy', message: '更新正在进行中。' }
    applying = true
    try {
      const result = await check()
      if (result.error) throw new Error(result.message)
      if (!result.updateAvailable) return { ok: false, error: 'no-update', message: '当前已是最新发布版本。' }
      publish('fetch', '正在下载并校验完整安装包…', 0)
      await autoUpdater.downloadUpdate()
      publish('restart', '安装包已校验，正在关闭程序并安装更新。', 100)
      // Install only after the normal quit guards and backend cleanup have completed.
      // quitAndInstall launches NSIS before those guards, so use its quit-event path.
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.autoRunAppAfterInstall = true
      setTimeout(() => app.quit(), 500)
      return { ok: true, handedOff: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      publish('error', message)
      return { ok: false, error: 'update-failed', message }
    } finally {
      applying = false
    }
  })
}
