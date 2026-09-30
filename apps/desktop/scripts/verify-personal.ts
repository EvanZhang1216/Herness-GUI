import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { startMockServer, MOCK_REPLY } from '../e2e/mock-server'

const root = path.resolve(import.meta.dirname, '../../..')
const sandbox = path.join(root, 'verification', `desktop-${Date.now()}`)
const home = path.join(sandbox, 'home')
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
  HERMES_HOME: home,
  HERMES_DESKTOP_USER_DATA_DIR: path.join(sandbox, 'electron'),
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
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide() })
  page.on('pageerror', error => console.error('Renderer:', error.message))
  const composer = page.locator('[contenteditable="true"]').first()
  await expect(composer).toBeVisible({ timeout: 90000 })
  await expect(page.getByRole('button', { name: 'Gateway ready', exact: true })).toBeVisible({ timeout: 90000 })
  const version = await page.evaluate(() => window.hermesDesktop.getVersion())
  expect(version.hermesRoot).toContain('resources')
  expect(version.hermesRoot).toContain('hermes')
  await composer.click()
  await composer.pressSequentially('Hello, verify the desktop conversation.', { delay: 30 })
  await composer.press('Enter')
  await expect(page.getByText(MOCK_REPLY, { exact: false }).first()).toBeVisible({ timeout: 90000 })
  await page.screenshot({ path: path.join(root, 'verification', 'desktop-chat.png') })
  console.log('PASS: packaged EXE -> real Hermes 2026.9.7 backend -> local mock inference -> rendered reply')
  await app.close()
  app = await electron.launch({
    executablePath: path.join(root, 'apps/desktop/release/win-unpacked/Herness GUI.exe'), env, timeout: 60000,
  })
  const restored = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide() })
  await expect(restored.getByRole('button', { name: 'Gateway ready', exact: true })).toBeVisible({ timeout: 90000 })
  await expect(restored.getByText(MOCK_REPLY, { exact: false }).first()).toBeVisible({ timeout: 30000 })
  const resumedComposer = restored.locator('[contenteditable="true"]').first()
  await resumedComposer.click()
  await resumedComposer.pressSequentially('Continue this saved conversation.', { delay: 30 })
  await resumedComposer.press('Enter')
  await expect(restored.getByText(MOCK_REPLY, { exact: false })).toHaveCount(2, { timeout: 90000 })
  await restored.screenshot({ path: path.join(root, 'verification', 'desktop-resumed.png') })
  console.log('PASS: restart EXE, restore saved conversation, submit follow-up and render second reply')
  await app.close()
  const freshHome = path.join(sandbox, 'fresh-home')
  fs.mkdirSync(freshHome, { recursive: true })
  app = await electron.launch({
    executablePath: path.join(root, 'apps/desktop/release/win-unpacked/Herness GUI.exe'),
    env: { ...env, HERMES_HOME: freshHome, HERMES_DESKTOP_USER_DATA_DIR: path.join(sandbox, 'fresh-electron') },
    timeout: 60000,
  })
  const fresh = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide() })
  await expect(fresh.getByRole('button', { name: "I'll choose a provider later", exact: true })).toBeVisible({ timeout: 90000 })
  await fresh.getByRole('button', { name: "I'll choose a provider later", exact: true }).click()
  await expect(fresh.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 30000 })
  await fresh.screenshot({ path: path.join(root, 'verification', 'desktop-first-run.png') })
  console.log('PASS: first run with empty user data and no API credentials opens model onboarding')
  console.log(`Sandbox: ${sandbox}`)
} finally {
  if (app) await app.close()
  await mock.close()
}
