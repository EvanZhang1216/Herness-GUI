import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, dialog } from 'electron'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = app.isPackaged ? process.resourcesPath : path.resolve(directory, '../..')
const runtime = path.join(root, 'runtime')
const source = app.isPackaged ? path.join(root, 'hermes') : path.join(root, 'vendor/hermes')
const python = path.join(runtime, 'python/python.exe')
if (!existsSync(python) || !existsSync(path.join(source, 'hermes_cli/main.py'))) {
  dialog.showErrorBox('Herness GUI', '内置运行时不完整，请重新安装完整离线安装包。Bundled runtime is missing.')
  app.exit(1)
} else {
  // The installer owns code/runtime; the user owns data in a separate directory.
  process.env.HERMES_DESKTOP_HERMES_ROOT = source
  process.env.HERMES_DESKTOP_PYTHON = python
  process.env.HERMES_HOME ??= path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'HernessGUI')
  process.env.HERMES_DESKTOP_APP_NAME ??= 'Herness GUI'
  process.env.PYTHONNOUSERSITE = '1'
  delete process.env.PYTHONHOME
  delete process.env.PYTHONPATH
  process.env.UV_PYTHON = python
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') || 'PATH'
  process.env[pathKey] = [
    path.join(runtime, 'python'), path.join(runtime, 'python/Scripts'),
    path.join(runtime, 'bin'), path.join(runtime, 'node'),
    path.join(runtime, 'git/cmd'), path.join(runtime, 'git/bin'),
    process.env[pathKey] || '',
  ].join(path.delimiter)
  await import('./dist/electron-main.mjs')
  const { registerDistributionUpdates } = await import('./dist/distribution-updates.mjs')
  registerDistributionUpdates({ source })
}
