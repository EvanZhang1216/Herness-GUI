export interface EndpointPreset {
  id: string
  name: string
  baseUrl: string
}

// Inspired by QuickModel's explicit provider setup; model IDs stay user-controlled.
export const ENDPOINT_PRESETS: EndpointPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'ollama', name: 'Ollama（本地 / Local）', baseUrl: 'http://127.0.0.1:11434/v1' },
]

export function normalizeEndpointUrl(value: string): string {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 必须是 http(s) 地址，不能包含账号密码、查询参数或片段。')
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/i, '')
  return url.toString().replace(/\/$/, '')
}
