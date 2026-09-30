import type { ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { assistantMessage, stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '../test-utils'

import { groupProcessingParts } from './processing-details'

import { Thread } from '.'

stubThreadEnvironment()
stubThreadViewportSize()
afterEach(cleanup)

it('collapses alternating reasoning and tools together while the answer stays visible, including after streaming', () => {
  const content: ThreadMessage['content'] = [
    { type: 'reasoning', text: 'First reasoning detail.' },
    { type: 'tool-call', toolCallId: 'one', toolName: 'web_search', args: { query: 'example' }, argsText: '{}', result: 'Search done' },
    { type: 'reasoning', text: 'Second reasoning detail.' },
    { type: 'text', text: 'The answer is ready.' }
  ]

  const message = { ...assistantMessage(), content, status: { type: 'running' } } as ThreadMessage
  const { container, rerender } = render(<ThreadRuntime messages={[message]}><Thread /></ThreadRuntime>)
  const group = container.querySelector('[data-slot="processing-details"]')!
  expect(container.querySelectorAll('[data-slot="processing-details"]')).toHaveLength(1)
  const button = group.querySelector('button')!
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText('First reasoning detail.').closest('[hidden]')).not.toBeNull()
  expect(screen.getByText('The answer is ready.').closest('[hidden]')).toBeNull()
  fireEvent.click(button)
  expect(screen.getByText('First reasoning detail.').closest('[hidden]')).toBeNull()
  expect(screen.getByText('Second reasoning detail.').closest('[hidden]')).toBeNull()
  rerender(<ThreadRuntime messages={[{ ...message, status: { type: 'complete', reason: 'stop' } }]}><Thread /></ThreadRuntime>)
  expect(group.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(group.querySelector('button')!)
  expect(screen.getByText('Second reasoning detail.').closest('[hidden]')).not.toBeNull()
  expect(screen.getByText('The answer is ready.').closest('[hidden]')).toBeNull()
})

it('keeps actions, failures, images and text outside the group without losing any original part', () => {
  const parts = [
    { type: 'reasoning', text: 'Reasoning' },
    { type: 'tool-call', toolName: 'terminal', result: 'done' },
    { type: 'tool-call', toolName: 'clarify' },
    { type: 'tool-call', toolName: 'setup_mcp' },
    { type: 'tool-call', toolName: 'terminal' },
    { type: 'tool-call', toolName: 'terminal', isError: true },
    { type: 'tool-call', toolName: 'image_generate' },
    { type: 'tool-call', toolName: 'delegate_task' },
    { type: 'text' },
    { type: 'reasoning', text: 'Reasoning' },
    { type: 'tool-call', toolName: 'web_search' },
    { type: 'text' }
  ]

  const groups = groupProcessingParts(parts)
  expect(groups.filter(group => group.groupKey)).toEqual([{ groupKey: 'process', indices: [0, 1, 9, 10] }])
  expect(groups.filter(group => !group.groupKey).flatMap(group => group.indices)).toEqual([2, 3, 4, 5, 6, 7, 8, 11])
  expect(groups.flatMap(group => group.indices).sort((a, b) => a - b)).toEqual(parts.map((_, index) => index))
})
