import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { app, dialog, ipcMain } from 'electron'
import { atomicWrite, validateDestination, migrateData } from './storage-core.mjs'

function readLocation(file) {
  const bytes = fs.readFileSync(file)
  return bytes.toString(bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '').trim()
}

export function prepareStorage({ root, python }) {
  const bootstrap = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'HernessGUI-bootstrap')
  const locationFile = path.join(bootstrap, 'location.txt')
  const pendingFile = path.join(bootstrap, 'migration.json')
  const external = Boolean(process.env.HERMES_HOME || process.env.HERMES_DESKTOP_USER_DATA_DIR)
  fs.mkdirSync(bootstrap, { recursive: true })
  const lock = path.join(bootstrap, 'migration.lock')
  if (fs.existsSync(lock)) throw new Error('数据迁移正在进行或上次迁移被中断。请检查 ' + bootstrap + ' 中的 migration.lock；确认无程序运行后移除锁文件再重试。')
  if (!external && fs.existsSync(pendingFile)) {
    const handle = fs.openSync(lock, 'wx')
    try {
      const plan = JSON.parse(fs.readFileSync(pendingFile, 'utf8'))
      const check = spawnSync(python, ['-c', `import psutil,sys,os
roots=[os.path.normcase(os.path.abspath(p)) for p in sys.argv[1:]]
for p in psutil.process_iter():
 try:
  if p.pid in (os.getpid(),os.getppid()): continue
  env=p.environ()
  home=env.get('HERMES_HOME','')
  if home and os.path.normcase(os.path.abspath(home)) in roots: sys.exit('其他 Hermes 进程仍在使用数据，请先关闭网关或终端。')
 except (psutil.AccessDenied,psutil.NoSuchProcess): pass
`, ...plan.sources.map(s => s.from)], { windowsHide: true, encoding: 'utf8' })
      if (check.error || check.status !== 0) throw new Error(check.stderr || check.error?.message || '无法检查数据占用')
      migrateData(plan, locationFile)
      fs.unlinkSync(pendingFile)
    } catch (error) {
      fs.renameSync(pendingFile, path.join(bootstrap, 'migration-failed-' + Date.now() + '.json'))
      dialog.showErrorBox('迁移未完成，继续使用原目录', String(error.message) + '\n原始数据已保留。目标目录可能含未完成的副本，请另选空目录重试。')
    } finally { fs.closeSync(handle); fs.unlinkSync(lock) }
  }
  const selected = fs.existsSync(locationFile) ? readLocation(locationFile) : null
  if (selected && !fs.existsSync(selected)) throw new Error('已配置的数据目录不可用，请连接对应磁盘：' + selected)
  if (selected && !path.isAbsolute(selected)) throw new Error('用户数据目录配置不是绝对路径。')
  // Keep legacy installations intact until the user explicitly requests migration.
  const home = process.env.HERMES_HOME || (selected ? path.join(selected, 'hermes') : path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'HernessGUI'))
  const desktop = process.env.HERMES_DESKTOP_USER_DATA_DIR || (selected ? path.join(selected, 'desktop') : app.getPath('userData'))
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(desktop, { recursive: true })
  process.env.HERMES_HOME = home
  process.env.HERMES_DESKTOP_USER_DATA_DIR = desktop
  return { home, desktop, selected, external, bootstrap, locationFile, pendingFile, root }
}
export function registerStorage(state) {
  ipcMain.handle('herness:storage:info', () => ({ home: state.home, desktop: state.desktop, root: state.selected, external: state.external }))
  ipcMain.handle('herness:storage:choose', async () => {
    const result = await dialog.showOpenDialog({ title: '选择新的空用户数据目录', properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  let scheduled = false
  ipcMain.handle('herness:storage:migrate', async (_event, target) => {
    if (scheduled) throw new Error('迁移已安排，请正常退出程序。')
    if (state.external) throw new Error('当前由环境变量指定数据目录，请移除 HERMES_HOME / HERMES_DESKTOP_USER_DATA_DIR 后再迁移。')
    if (typeof target !== 'string') throw new Error('无效目录')
    const forbidden = [state.root, path.dirname(app.getPath('exe')), state.bootstrap]
    target = validateDestination(target, [state.home, state.desktop, ...forbidden])
    const result = await dialog.showMessageBox({ type: 'question', buttons: ['迁移并重启', '取消'], defaultId: 1, cancelId: 1,
      title: '迁移完整用户数据', message: '将用户数据迁移到：' + target,
      detail: '请先结束任务并关闭独立网关。程序退出后会复制并校验聊天、密钥、技能、记忆和桌面设置。成功后使用新目录，原目录保留备份。外部项目文件及远程服务器数据不移动。' })
    if (result.response !== 0) return { scheduled: false }
    // will-quit is reached only after upstream active-task guards and backend teardown.
    scheduled = true
    app.once('will-quit', () => {
      atomicWrite(state.pendingFile, JSON.stringify({ target, sources: [{ name: 'hermes', from: state.home }, { name: 'desktop', from: state.desktop }], forbidden }))
      delete process.env.HERMES_HOME
      delete process.env.HERMES_DESKTOP_USER_DATA_DIR
      app.relaunch()
    })
    setTimeout(() => app.quit(), 200)
    return { scheduled: true }
  })
}
