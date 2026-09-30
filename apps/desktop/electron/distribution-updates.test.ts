import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  updater: {
    on: vi.fn(), setFeedURL: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(),
    autoDownload: true, autoInstallOnAppQuit: true, allowPrerelease: true, allowDowngrade: true,
  },
  quit: vi.fn(), send: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0', quit: state.quit },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: state.send } }] },
  ipcMain: {
    removeHandler: (key: string) => state.handlers.delete(key),
    handle: (key: string, handler: (...args: any[]) => any) => state.handlers.set(key, handler),
  },
}))
vi.mock('electron-updater', () => ({ default: { autoUpdater: state.updater } }))
import { registerDistributionUpdates } from './distribution-updates'

beforeEach(() => { vi.clearAllMocks(); state.handlers.clear() })
describe('distribution update contract', () => {
  it('only checks our stable release feed and never downloads during a check', async () => {
    state.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } })
    registerDistributionUpdates({ source: '/bundle/hermes' })
    const result = await state.handlers.get('hermes:updates:check')!()
    expect(result.updateAvailable).toBe(true)
    expect(state.updater.setFeedURL).toHaveBeenCalledWith({ provider: 'github', owner: 'EvanZhang1216', repo: 'Herness-GUI' })
    expect(state.updater.autoDownload).toBe(false)
    expect(state.updater.allowDowngrade).toBe(false)
    expect(state.updater.downloadUpdate).not.toHaveBeenCalled()
  })
  it('a failed download never quits or installs and a later retry remains available', async () => {
    state.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } })
    state.updater.downloadUpdate.mockRejectedValue(new Error('download interrupted'))
    registerDistributionUpdates({ source: '/bundle/hermes' })
    const apply = state.handlers.get('hermes:updates:apply')!
    expect((await apply()).ok).toBe(false)
    expect((await apply()).error).toBe('update-failed')
    expect(state.quit).not.toHaveBeenCalled()
    expect(state.updater.autoInstallOnAppQuit).toBe(false)
  })
})
