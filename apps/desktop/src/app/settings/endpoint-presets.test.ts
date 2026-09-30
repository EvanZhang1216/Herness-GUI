import { describe, it, expect } from 'vitest'
import { normalizeEndpointUrl } from './endpoint-presets'

describe('endpoint setup', () => {
  it('normalizes a pasted completion URL while preserving a proxy path', () => {
    const base = 'https://example.com/tenant/openai/v1'
    expect(normalizeEndpointUrl(`${base}/chat/completions/`)).toBe(base)
    expect(normalizeEndpointUrl(`${base}/models`)).toBe(base)
    expect(normalizeEndpointUrl(base)).toBe(base)
  })
  it('rejects credentials and token-bearing URL queries', () => {
    for (const url of ['https://user:secret@example.com/v1', 'https://example.com/v1?key=secret', 'file:///v1']) {
      expect(() => normalizeEndpointUrl(url)).toThrow()
    }
  })
})
