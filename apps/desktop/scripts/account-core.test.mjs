import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { normalizeSyncServer, accountPaths } from '../account-core.mjs'

describe('account security boundaries', () => {
  it('allows HTTPS and loopback tunnels but rejects credential-bearing and public HTTP endpoints', () => {
    expect(normalizeSyncServer('https://sync.example.com/')).toBe('https://sync.example.com')
    expect(normalizeSyncServer('http://127.0.0.1:18789')).toBe('http://127.0.0.1:18789')
    for (const url of ['http://39.107.193.57', 'https://user:secret@example.com', 'https://example.com?token=secret', 'file:///secret']) {
      expect(() => normalizeSyncServer(url)).toThrow()
    }
  })
  it('separates visitor data, users and servers without accepting path traversal as an account ID', () => {
    const storage = { home: path.resolve('visitor'), desktop: path.resolve('desktop') }
    const first = { endpoint: 'https://one.example.com', account: { id: '6a5764c6-4c16-4bc3-a0c1-6cab97ea06c3' } }
    expect(accountPaths(storage, { account: null })).toEqual(storage)
    const a = accountPaths(storage, first)
    const b = accountPaths(storage, { ...first, account: { id: '3f8c95af-d091-4727-93f2-37fcd334d27a' } })
    const c = accountPaths(storage, { ...first, endpoint: 'https://two.example.com' })
    expect(new Set([a.home, b.home, c.home, storage.home]).size).toBe(4)
    expect(() => accountPaths(storage, { ...first, account: { id: '../../other' } })).toThrow()
  })
})
