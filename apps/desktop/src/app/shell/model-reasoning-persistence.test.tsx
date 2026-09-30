import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { $activeSessionId, $currentReasoningEffort, $defaultReasoningEffort } from '@/store/session'

import type { ModelMenuController } from './model-catalog-menu'
import { ModelMenuPanel } from './model-menu-panel'

vi.mock('@/hermes', () => ({
  getGlobalModelOptions: async () => ({ providers: [] }),
  setApiRequestProfile: vi.fn()
}))
vi.mock('@/store/notifications', () => ({ notifyError: vi.fn() }))
vi.mock('./model-catalog-menu', () => ({
  ModelCatalogMenu: ({ controller }: { controller: ModelMenuController }) => <>
    <button onClick={() => controller.setOptions({ effort: 'high' }, { provider: 'mock', model: 'mock-model', isActive: true })}>High</button>
    <button onClick={() => controller.setOptions({ effort: 'none' }, { provider: 'mock', model: 'mock-model', isActive: true })}>Off</button>
  </>
}))
afterEach(cleanup)

it('persists both thinking options for a draft and a live chat', async () => {
  for (const sessionId of ['', 'live-session']) {
    $activeSessionId.set(sessionId)
    const request = vi.fn(async () => ({}))
    render(<QueryClientProvider client={new QueryClient()}><ModelMenuPanel onSelectModel={() => {}} requestGateway={request as never} /></QueryClientProvider>)

    for (const [label, value] of [['High', 'high'], ['Off', 'none']]) {
      fireEvent.click(screen.getByText(label))
      await waitFor(() => expect(request).toHaveBeenCalledWith('config.set', {
        key: 'reasoning', scope: 'global', session_id: sessionId || undefined, value
      }))
      await waitFor(() => expect($defaultReasoningEffort.get()).toBe(value))
    }

    cleanup()
  }
})

it('rolls back a failed save without replacing the saved default', async () => {
  $activeSessionId.set('live-session')
  $currentReasoningEffort.set('low')
  $defaultReasoningEffort.set('low')
  const request = vi.fn(async () => { throw new Error('Disk full') })
  render(<QueryClientProvider client={new QueryClient()}><ModelMenuPanel onSelectModel={() => {}} requestGateway={request as never} /></QueryClientProvider>)
  fireEvent.click(screen.getByText('High'))
  await waitFor(() => expect(request).toHaveBeenCalled())
  await waitFor(() => expect($currentReasoningEffort.get()).toBe('low'))
  expect($defaultReasoningEffort.get()).toBe('low')
})
