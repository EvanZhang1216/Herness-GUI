import { _electron as electron, expect, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { accountPaths } from '../account-core.mjs'
import { startMockServer, MOCK_REPLY } from '../e2e/mock-server'

const root = path.resolve(import.meta.dirname, '../../..')
const sandbox = path.join(root, 'verification', `accounts-${Date.now()}`)
const endpoint = process.env.SYNC_TEST_ENDPOINT || 'http://127.0.0.1:18789'
const username = `desktop_${Date.now()}`
const password = 'Local-test-' + crypto.randomUUID()
const mock = await startMockServer()
const executablePath = path.join(root, 'apps/desktop/release/win-unpacked/Herness GUI.exe')
let app: ElectronApplication | undefined
function device(name: string) {
  const data = path.join(sandbox, name)
  const local = path.join(data, 'local')
  const storage = { home: path.join(data, 'data', 'hermes'), desktop: path.join(data, 'data', 'desktop') }
  fs.mkdirSync(path.join(data, 'data'), { recursive: true })
  fs.mkdirSync(path.join(local, 'HernessGUI-bootstrap'), { recursive: true })
  fs.writeFileSync(path.join(local, 'HernessGUI-bootstrap', 'location.txt'), path.join(data, 'data'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined &&
    !/(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/.test(k) && !/^HERMES_|^PYTHON|^CONDA|^VIRTUAL_ENV$/i.test(k))) as Record<string, string>
  Object.assign(env, { LOCALAPPDATA: local, HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1',
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost' })
  return { storage, env, config: path.join(storage.home, '.herness-account.json') }
}
async function open(fixture: ReturnType<typeof device>) {
  app = await electron.launch({ executablePath, env: fixture.env, timeout: 90000 })
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.hermesDesktop?.account)
  await app.evaluate(({ BrowserWindow, app, dialog }) => {
    BrowserWindow.getAllWindows().forEach(window => window.hide())
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    app.relaunch = () => {}
  })
  return page
}
function configure(fixture: ReturnType<typeof device>) {
  const config = JSON.parse(fs.readFileSync(fixture.config, 'utf8'))
  expect(config.encryptedToken).toBeTruthy()
  expect(fs.readFileSync(fixture.config, 'utf8')).not.toContain(password)
  const selected = accountPaths(fixture.storage, config)
  fs.mkdirSync(selected.home, { recursive: true })
  fs.writeFileSync(path.join(selected.home, 'config.yaml'), `model:\n  default: mock-model\n  provider: mock\nproviders:\n  mock:\n    api: ${mock.url}/v1\n    api_mode: chat_completions\n    key_env: MOCK_API_KEY\n    models:\n      mock-model: {}\n    context_length: 32768\nauxiliary:\n  title_generation:\n    enabled: false\n`)
  fs.writeFileSync(path.join(selected.home, '.env'), 'MOCK_API_KEY=local-test-only\n')
  return config
}
try {
  expect((await fetch(endpoint + '/health')).ok).toBe(true)
  const a = device('设备甲'), b = device('设备乙')
  let page = await open(a)
  await page.getByRole('button', { name: '注册新账号', exact: true }).click()
  await page.getByLabel('同步服务器地址', { exact: true }).fill(endpoint)
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('邮箱', { exact: true }).fill(username + '@example.com')
  await page.getByLabel('密码', { exact: true }).fill(password)
  const registered = app!.waitForEvent('close', { timeout: 60000 })
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await registered; app = undefined
  console.log('PASS: registration and account switch completed')
  configure(a)
  page = await open(a)
  await expect(page.getByRole('button', { name: 'Gateway ready', exact: true })).toBeVisible({ timeout: 90000 })
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.hide()))
  const input = page.locator('[contenteditable="true"]').first()
  await input.fill('Remember this conversation across my devices.')
  await input.press('Enter')
  await expect(page.getByText(MOCK_REPLY, { exact: false }).first()).toBeVisible({ timeout: 90000 })
  console.log('PASS: first account chat response rendered')
  await expect.poll(async () => {
    const info = await page.evaluate(() => window.hermesDesktop.account.sync())
    if (info.sync.error) throw new Error(info.sync.error)
    return info.sync.used_bytes ?? 0
  }, { timeout: 60000 }).toBeGreaterThan(0)
  await app!.close(); app = undefined
  console.log('PASS: packaged registration UI, encrypted login persistence, real chat uploaded')
  page = await open(b)
  await page.getByLabel('同步服务器地址', { exact: true }).fill(endpoint)
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  const logged = app!.waitForEvent('close', { timeout: 60000 })
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await logged; app = undefined
  configure(b)
  page = await open(b)
  const sync = await page.evaluate(() => window.hermesDesktop.account.sync())
  expect(sync.sync.error).toBeFalsy()
  expect(sync.sync.pending_downloads).toBeGreaterThan(0)
  const applied = app!.waitForEvent('close', { timeout: 60000 })
  await page.evaluate(() => window.hermesDesktop.account.apply())
  await applied; app = undefined
  page = await open(b)
  await expect(page.getByRole('button', { name: 'Gateway ready', exact: true })).toBeVisible({ timeout: 90000 })
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.hide()))
  // A new Electron profile has no selected chat; select the imported history in the sidebar.
  const history = page.getByRole('button', { name: 'Remember this conversation across my devices.', exact: true })
  await expect(history).toBeVisible({ timeout: 60000 })
  await history.click({ force: true })
  await expect(page.getByText(MOCK_REPLY, { exact: false }).first()).toBeVisible({ timeout: 30000 })
  const continued = page.locator('[contenteditable="true"]').first()
  await continued.fill('Continue from the second device.')
  await continued.press('Enter')
  await expect(page.getByText(MOCK_REPLY, { exact: false })).toHaveCount(2, { timeout: 90000 })
  const devices = await page.evaluate(() => window.hermesDesktop.account.devices())
  expect(devices.length).toBe(2)
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.showInactive()))
  await page.screenshot({ path: path.join(root, 'verification', 'account-device-b.png') })
  console.log('PASS: second device login, cloud history applied, original chat continued, both devices listed')
  console.log(`Test account: ${username}; sandbox: ${sandbox}`)
} catch (error) {
  console.error(error)
  if (app) {
    const page = app.windows()[0]
    if (page) {
      console.error((await page.locator('body').innerText({ timeout: 5000 })).slice(-5000))
    }
  }
  throw error
} finally {
  if (app) await app.close()
  await mock.close()
}
