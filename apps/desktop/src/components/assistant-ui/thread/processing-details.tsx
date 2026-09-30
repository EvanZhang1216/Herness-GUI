import { MessagePrimitive, useAuiState } from '@assistant-ui/react'
import { type ComponentProps, type PropsWithChildren, useState } from 'react'

import { APPROVAL_TOOLS } from '@/components/assistant-ui/tool/approval'
import { SCAFFOLD_META_CLASS, ScaffoldRow } from '@/components/chat/scaffold-row'
import { useI18n } from '@/i18n'
import { isTodoToolName } from '@/lib/todos'

import { MESSAGE_PARTS_COMPONENTS } from './message-parts'

interface ProcessPart {
  type: string
  text?: string
  toolName?: string
  isError?: boolean
  result?: unknown
  status?: { type: string }
}

const STANDALONE_TOOLS = new Set(['clarify', 'setup_mcp', 'image_generate', 'delegate_task'])

// Only presentation changes: every original part retains its runtime/index.
// Actions and generated images must remain accessible outside the disclosure.
export function groupProcessingParts(parts: readonly ProcessPart[]) {
  const groups: { groupKey: string | undefined; indices: number[] }[] = []
  const process = { groupKey: 'process', indices: [] as number[] }
  parts.forEach((part, index) => {
    const pendingApprovalTool = APPROVAL_TOOLS.has(part.toolName ?? '') && part.result === undefined

    const tool = part.type === 'tool-call' && !part.isError && !pendingApprovalTool && part.status?.type !== 'requires-action' &&
      !STANDALONE_TOOLS.has(part.toolName ?? '') && !isTodoToolName(part.toolName ?? '')

    if ((part.type === 'reasoning' && Boolean(part.text?.trim())) || tool) {
      if (!process.indices.length) {groups.push(process)}
      process.indices.push(index)
    } else {
      groups.push({ groupKey: undefined, indices: [index] })
    }
  })

  return groups
}

function ProcessingGroup({ children, groupKey, indices }: PropsWithChildren<{
  groupKey: string | undefined
  indices: number[]
}>) {
  const [open, setOpen] = useState(false)
  const running = useAuiState(s => s.message.status?.type === 'running')
  const { t } = useI18n()

  if (!groupKey) {return children}

  return (
    <div className="my-2" data-slot="processing-details">
      <ScaffoldRow onToggle={() => setOpen(value => !value)} open={open}>
        <span>{running ? t.processingDetails.running : t.processingDetails.title}</span>
        <span className={SCAFFOLD_META_CLASS}>{t.processingDetails.steps(indices.length)}</span>
      </ScaffoldRow>
      <div className="mt-2 max-h-96 overflow-auto space-y-2 border-l border-(--ui-stroke-tertiary) pl-3" hidden={!open}>
        {children}
      </div>
    </div>
  )
}

const COMPONENTS = {
  ...MESSAGE_PARTS_COMPONENTS,
  Group: ProcessingGroup
} satisfies ComponentProps<typeof MessagePrimitive.Unstable_PartsGrouped>['components']

export function ProcessingMessageParts() {
  // Non-adjacent clustering keeps one process row even when commentary appears
  // between tool calls. Answer text stays outside, in its original order.
  return <MessagePrimitive.Unstable_PartsGrouped components={COMPONENTS} groupingFunction={groupProcessingParts} />
}
