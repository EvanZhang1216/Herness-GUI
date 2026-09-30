import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { startMockServer, MOCK_REPLY } from '../e2e/mock-server'

async function allowLocalMode(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => !!window.hermesDesktop?.account)
  const state = await page.evaluate(() => window.hermesDesktop.account.info())
  if (!state.welcomed) await page.getByRole('button', { name: '暂不登录，使用本地模式', exact: true }).click()
}

const root = path.resolve(import.meta.dirname, '../../..')
const sandbox = path.join(root, 'verification', `desktop-${Date.now()}`)
const initialRoot = path.join(sandbox, 'original-data')
const home = path.join(initialRoot, 'hermes')
const local = path.join(sandbox, 'local-app-data')
const bootstrap = path.join(local, 'HernessGUI-bootstrap')
fs.mkdirSync(bootstrap, { recursive: true })
fs.mkdirSync(initialRoot, { recursive: true })
fs.writeFileSync(path.join(bootstrap, 'location.txt'), initialRoot)
fs.mkdirSync(home, { recursive: true })
const mock = await startMockServer()
fs.writeFileSync(path.join(home, 'config.yaml'), `model:
  default: mock-model
  provider: mock
providers:
  mock:
    api: ${mock.url}/v1
    api_mode: chat_completions
    key_env: MOCK_API_KEY
    models:
      mock-model: {}
    context_length: 32768
auxiliary:
  title_generation:
    enabled: false
`)
fs.writeFileSync(path.join(home, '.env'), 'MOCK_API_KEY=local-test-only\n')
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
  value !== undefined && !/(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/.test(key) &&
  !/^HERMES_|^PYTHON|^CONDA|^VIRTUAL_ENV$|^PATH$/i.test(key))) as Record<string, string>
Object.assign(env, {
  PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
  HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
  NO_PROXY: '127.0.0.1,localhost',
  LOCALAPPDATA: local,
  HERMES_DESKTOP_APP_NAME: `HermesVerification-${Date.now()}`,
  HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1',
})
let app
try {
  app = await electron.launch({
    executablePath: path.join(root, 'apps/desktop/release/win-unpacked/Herness GUI.exe'),
    env,
    timeout: 60000,
  })
  const page = await app.firstWindow()
  await allowLocalMode(page)
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide() })
  page.on('pageerror', error => console.error('Renderer:', error.message))
  const composer = page.locator('[contenteditable="true"]').first()
  await expect(composer).toBeVisible({ timeout: 90000 })
  await expect(page.getByRole('button', { name: 'Gateway ready', exact: true })).toBeVisible({ timeout: 90000 })
  const version = await page.evaluate(() => window.hermesDesktop.getVersion())
  expect(version.hermesRoot).toContain('resources')
  expect(version.hermesRoot).toContain('hermes')
  await page.getByRole('button', { name: '模型设置', exact: true }).click({ force: true })
  await expect(page).toHaveURL(/tab=config:model/)
  await expect(page.getByRole('heading', { name: '模型设置', exact: true })).toBeVisible({ timeout: 30000 })
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.showInactive() })
  await page.screenshot({ path: path.join(root, 'verification', 'model-settings-shortcut.png') })
  await page.getByRole('button', { name: '自定义 API · 地址 / 模型 / Key', exact: true }).click()
  await expect(page).toHaveURL(/tab=providers&pview=custom-endpoints/)
  await page.goBack()
  await page.getByRole('button', { name: 'API 密钥', exact: true }).click()
  await expect(page).toHaveURL(/tab=providers&pview=keys/)
  await page.goBack()
  await page.goBack()
  await expect(composer).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide() })
  console.log('PASS: prominent model settings opens in one click; endpoint and API-key shortcuts reach their pages')
  await composer.click({ force: true })
  await composer.pressSequentially('Hello, verify the desktop conversation.', { delay: 30 })
  await composer.press('Enter')
  await expect(page.getByText(MOCK_REPLY, { exact: false }).first()).toBeVisible({ timeout: 90000 })
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.showInactive() })
  await page.screenshot({ path: path.join(root, 'verification', 'desktop-chat.png') })
  console.log('PASS: packaged EXE -> real Hermes 2026.9.7 backend -> local mock inference -> rendered reply')
  await app.close()
  app = await electron.launch({
    executablePath: path.join(root, 'apps/desktop/release/win-unpacked/Herness GUI.exe'), env, timeout: 60000,
  })
  const restored = await app.firstWindow()
  await allowLocalMode(restored)
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide() })
  await expect(restored.getByRole('button', { name: 'Gateway ready', exact: true })).toBeVisible({ timeout: 90000 })
  await expect(restored.getByText(MOCK_REPLY, { exact: false }).first()).toBeVisible({ timeout: 30000 })
  const resumedComposer = restored.locator('[contenteditable="true"]').first()
  await resumedComposer.click({ force: true })
  await resumedComposer.pressSequentially('Continue this saved conversation.', { delay: 30 })
  await resumedComposer.press('Enter')
  await expect(restored.getByText(MOCK_REPLY, { exact: false })).toHaveCount(2, { timeout: 90000 })
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.showInactive() })
  await restored.screenshot({ path: path.join(root, 'verification', 'desktop-resumed.png') })
  console.log('PASS: restart EXE, restore saved conversation, submit follow-up and render second reply')
  const moved = path.join(sandbox, '迁移后的完整数据')
  await app.evaluate(({ app, dialog }) => {
    // Accept the native confirmation while keeping relaunch under test control.
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    app.relaunch = () => {}
  })
  const closed = app.waitForEvent('close')
  const scheduled = await restored.evaluate(target => window.hermesDesktop.storage.migrate(target), moved)
  expect(scheduled.scheduled).toBe(true)
  await closed
  app = undefined
  expect(fs.existsSync(path.join(bootstrap, 'migration.json'))).toBe(true)
  const migrationEnv = { ...env }
  app = await electron.launch({
    executablePath: path.join(root, 'apps/desktop/release/win-unpacked/Herness GUI.exe'), env: migrationEnv, timeout: 90000,
  })
  const migrated = await app.firstWindow()
  await allowLocalMode(migrated)
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide() })
  await expect(migrated.getByRole('button', { name: 'Gateway ready', exact: true })).toBeVisible({ timeout: 90000 })
  await expect(migrated.getByText(MOCK_REPLY, { exact: false })).toHaveCount(2, { timeout: 30000 })
  const storage = await migrated.evaluate(() => window.hermesDesktop.storage.info())
  expect(storage.home).toBe(path.join(moved, 'hermes'))
  expect(storage.desktop).toBe(path.join(moved, 'desktop'))
  expect(fs.readFileSync(path.join(moved, 'hermes', '.env'), 'utf8')).toContain('MOCK_API_KEY=local-test-only')
  expect(fs.existsSync(home)).toBe(true)
  const movedComposer = migrated.locator('[contenteditable="true"]').first()
  await movedComposer.pressSequentially('Continue after moving all user data.', { delay: 30 })
  await movedComposer.press('Enter')
  await expect(migrated.getByText(MOCK_REPLY, { exact: false })).toHaveCount(3, { timeout: 90000 })
  console.log('PASS: full Hermes and Electron data migration, credentials retained, history resumed with another reply')
  await movedComposer.pressSequentially('E2E_PROCESSING_DETAILS', { delay: 30 })
  await movedComposer.press('Enter')
  await expect(migrated.getByText('Processing disclosure verification complete.', { exact: true })).toBeVisible({ timeout: 90000 })
  const processGroup = migrated.locator('[data-slot="processing-details"]')
  await expect(processGroup).toHaveCount(1)
  const processToggle = processGroup.locator('button').first()
  await expect(processToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(migrated.getByText('Checking local step 1.', { exact: true })).toBeHidden()
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.showInactive() })
  await migrated.screenshot({ path: path.join(root, 'verification', 'processing-collapsed.png') })
  await processToggle.click()
  await expect(migrated.getByText('Checking local step 1.', { exact: true })).toBeVisible()
  await expect(migrated.getByText('Checking local step 3.', { exact: true })).toBeVisible()
  await migrated.screenshot({ path: path.join(root, 'verification', 'processing-expanded.png') })
  await processToggle.click()
  await expect(migrated.getByText('Processing disclosure verification complete.', { exact: true })).toBeVisible()
  console.log('PASS: real backend reasoning and three terminal calls fold into one row; expand and collapse preserve the answer')
  await app.close()
  const freshHome = path.join(sandbox, 'fresh-home')
  fs.mkdirSync(freshHome, { recursive: true })
  const freshLocal = path.join(sandbox, 'fresh-local')
  fs.mkdirSync(path.join(freshLocal, 'HernessGUI-bootstrap'), { recursive: true })
  fs.writeFileSync(path.join(freshLocal, 'HernessGUI-bootstrap', 'location.txt'), '\uFEFF' + freshHome, 'utf16le')
  const freshEnv = { ...migrationEnv, LOCALAPPDATA: freshLocal }
  app = await electron.launch({
    executablePath: path.join(root, 'apps/desktop/release/win-unpacked/Herness GUI.exe'),
    env: freshEnv,
    timeout: 60000,
  })
  const fresh = await app.firstWindow()
  await allowLocalMode(fresh)
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide() })
  await expect(fresh.getByRole('button', { name: "I'll choose a provider later", exact: true })).toBeVisible({ timeout: 90000 })
  await fresh.getByRole('button', { name: "I'll choose a provider later", exact: true }).click({ force: true })
  await expect(fresh.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 30000 })
  expect((await fresh.evaluate(() => window.hermesDesktop.storage.info())).home).toBe(path.join(freshHome, 'hermes'))
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.showInactive() })
  await fresh.screenshot({ path: path.join(root, 'verification', 'desktop-first-run.png') })
  console.log('PASS: first run with empty user data and no API credentials opens model onboarding')
  console.log(`Sandbox: ${sandbox}`)
} finally {
  if (app) await app.close()
  await mock.close()
}
