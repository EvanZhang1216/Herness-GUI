import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { JsonRpcGatewayClient } from '../../shared/src/json-rpc-gateway'
import { startMockServer } from '../e2e/mock-server'

// Exercise the installed transport and real Hermes imports, with isolated data
// and local inference only. No user's credentials, history or API budget involved.
const root = path.resolve(import.meta.dirname, '../../..')
const sandbox = path.join(root, 'verification', `unified-${Date.now()}`)
const data = path.join(sandbox, 'data')
const home = path.join(data, 'hermes')
const local = path.join(sandbox, 'local')
fs.mkdirSync(home, { recursive: true })
fs.mkdirSync(path.join(local, 'HernessGUI-bootstrap'), { recursive: true })
fs.writeFileSync(path.join(local, 'HernessGUI-bootstrap/location.txt'), data)
const mock = await startMockServer({ holdFirstStreamForPrompt: 'hold-shared-change' })
const requests: { route: string; key: string; body: any }[] = []
async function proxy(route: string) {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks)
    if (req.url?.endsWith('/chat/completions')) {
      requests.push({ route, key: req.headers.authorization || '', body: JSON.parse(body.toString()) })
    }
    const upstream = http.request(`${mock.url}${req.url}`, { method: req.method, headers: req.headers }, reply => {
      res.writeHead(reply.statusCode || 500, reply.headers)
      reply.pipe(res)
    })
    upstream.on('error', error => res.destroy(error))
    upstream.end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${(server.address() as any).port}/v1` }
}
const first = await proxy('first')
const second = await proxy('second')
function configure(url: string, key: string, model = 'mock-model') {
  fs.writeFileSync(path.join(home, 'config.yaml'), `model:
  default: ${model}
  provider: mock
providers:
  mock:
    api: ${url}
    api_mode: chat_completions
    key_env: MOCK_API_KEY
    models:
      mock-model: {}
      second-model: {}
    context_length: 32768
auxiliary:
  title_generation:
    enabled: false
`)
  fs.writeFileSync(path.join(home, '.env'), `MOCK_API_KEY=${key}\n`)
}
configure(first.url, 'test-first')
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
  !/(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/.test(key) && !/^HERMES_|^PYTHON|^CONDA|^VIRTUAL_ENV$|^PATH$/i.test(key))) as Record<string, string>
Object.assign(env, { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
  LOCALAPPDATA: local, HERMES_DESKTOP_APP_NAME: `UnifiedVerification-${Date.now()}`,
  HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1', HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost' })
let app: Awaited<ReturnType<typeof electron.launch>> | undefined
let rpc: JsonRpcGatewayClient
async function boot() {
  app = await electron.launch({ executablePath: path.join(root, 'apps/desktop/release/win-unpacked/Herness GUI.exe'), env, timeout: 60000 })
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.hermesDesktop?.account)
  if (!(await page.evaluate(() => window.hermesDesktop.account.info())).welcomed) {
    await page.getByRole('button', { name: '暂不登录，使用本地模式', exact: true }).click()
  }
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide() })
  await expect(page.getByRole('button', { name: 'Gateway ready', exact: true })).toBeVisible({ timeout: 90000 })
  const result = await page.evaluate(() => window.hermesDesktop.getGatewayWsUrl('default'))
  if (typeof result !== 'string' && !result.ok) throw new Error(result.error)
  rpc = new JsonRpcGatewayClient()
  await rpc.connect(typeof result === 'string' ? result : result.wsUrl)
}
async function turn(sid: string, text: string) {
  const completed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { off(); reject(new Error(`Timed out: ${text}`)) }, 90000)
    const off = rpc.onAny(event => {
      if (event.session_id !== sid) return
      if (event.type === 'message.complete' || event.type === 'error') {
        clearTimeout(timeout); off()
        if (event.type === 'error') reject(new Error(JSON.stringify(event.payload)))
        else resolve()
      }
    })
  })
  await rpc.request('prompt.submit', { session_id: sid, text })
  await completed
  return requests.findLast(row => row.body.messages?.some((message: any) => message.role === 'user' && message.content === text))!
}
try {
  await boot()
  const a = await rpc.request<any>('session.create', { source: 'desktop', model: 'deepseek-chat', provider: 'deepseek' })
  const b = await rpc.request<any>('session.create', { source: 'desktop' })
  const before = await turn(a.session_id, 'first-shared-a')
  expect(before.body.model).toBe('mock-model')
  expect((await turn(b.session_id, 'first-shared-b')).route).toBe('first')
  console.log('PASS: two desktop chats use the shared endpoint, ignoring stale create overrides')

  const held = turn(a.session_id, 'hold-shared-change')
  await mock.waitForHeldStream()
  const changed = await rpc.request<any>('config.set', { session_id: b.session_id, key: 'model', value: 'second-model --provider mock' })
  expect(changed.scope).toBe('global')
  mock.releaseHeldStream()
  expect((await held).body.model).toBe('mock-model')
  expect((await turn(a.session_id, 'second-shared-a')).body.model).toBe('second-model')
  expect((await turn(b.session_id, 'second-shared-b')).body.model).toBe('second-model')
  console.log('PASS: shared switch preserves the in-flight response; both next turns adopt it')

  configure(second.url, 'test-second', 'second-model')
  const after = await turn(a.session_id, 'changed-endpoint-a')
  const afterB = await turn(b.session_id, 'changed-endpoint-b')
  for (const row of [after, afterB]) {
    expect(row.route).toBe('second')
    expect(row.key).toBe('Bearer test-second')
  }
  expect(after.body.messages.filter((m: any) => m.role === 'system')).toEqual(before.body.messages.filter((m: any) => m.role === 'system'))
  console.log('PASS: same model with new URL/key routes both chats correctly and preserves the system prefix')
  rpc.close()
  await app!.close(); app = undefined

  // Simulate a saved/cloud-restored conversation from the old per-session policy.
  execFileSync(path.join(root, 'runtime/python/python.exe'), ['-c',
    "import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); c.execute('UPDATE sessions SET model=?, model_config=? WHERE id=?',('deepseek-chat',json.dumps({'provider':'deepseek','model':'deepseek-chat'}),sys.argv[2])); c.commit()",
    path.join(home, 'state.db'), a.stored_session_id])
  await boot()
  const resumed = await rpc.request<any>('session.resume', { session_id: a.stored_session_id, source: 'desktop' })
  const restored = await turn(resumed.session_id, 'resumed-stale-provider')
  expect(restored.route).toBe('second')
  expect(restored.body.model).toBe('second-model')
  expect(restored.key).toBe('Bearer test-second')
  console.log('PASS: restart and resume ignore persisted DeepSeek credentials and continue the same history')
} catch (error) {
  console.error(error)
  throw error
} finally {
  mock.releaseHeldStream()
  rpc?.close()
  if (app) await app.close()
  first.server.closeAllConnections(); first.server.close()
  second.server.closeAllConnections(); second.server.close()
  await mock.close()
}
