import { type QueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'

import type { ModelSelection } from '@/app/shell/model-menu-panel'
import { getGlobalModelInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { surfaceModelSwitchConfirm } from '@/lib/guarded-model-switch'
import { manualPickRemoved, modelOptionsQueryKey } from '@/lib/model-options'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $activeSessionId,
  $currentModel,
  $currentProvider,
  getComposerSelectionGeneration,
  getCurrentModelSource,
  markComposerSelectionManual,
  setCurrentModel,
  setCurrentModelSource,
  setCurrentProvider
} from '@/store/session'
import { $sessionStates, sessionTileDelegate } from '@/store/session-states'
import type { ModelOptionsResponse } from '@/types/hermes'

interface ModelControlsOptions {
  cacheOwnerConnectionId?: string
  cacheProfile?: string
  queryClient: QueryClient
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

interface ModelSwitchResponse {
  confirm_message?: string
  confirm_required?: boolean
  deferred?: boolean
}

export function useModelControls({
  cacheOwnerConnectionId,
  cacheProfile,
  queryClient,
  requestGateway
}: ModelControlsOptions) {
  const { t } = useI18n()
  const copy = t.desktop
  const profileRefreshEpochRef = useRef(0)

  // All callbacks here read reactive session state from the store (.get())
  // rather than capturing it as a prop. The actions bag in wiring.tsx mutates
  // in place to keep a stable identity, so memoized surfaces capture these
  // callbacks once and never re-evaluate — a captured prop would be stale
  // forever. The store read is always current.
  const updateModelOptionsCache = useCallback(
    (
      sessionId: null | string,
      provider: string,
      model: string,
      includeGlobal: boolean,
      profile = cacheProfile || $activeGatewayProfile.get(),
      ownerConnectionId = cacheOwnerConnectionId
    ) => {
      const patch = (prev: ModelOptionsResponse | undefined) => {
        // Selection state can update before the catalog query has resolved.
        // Keep that optimistic cache structurally complete; the composer
        // interprets a response without `providers` as an empty catalog.
        const providers = prev?.providers?.length
          ? prev.providers
          : provider && model
            ? [{ models: [model], name: provider, slug: provider }]
            : []

        return { ...prev, provider, model, providers }
      }

      queryClient.setQueryData<ModelOptionsResponse>(modelOptionsQueryKey(profile, sessionId, ownerConnectionId), patch)

      if (includeGlobal) {
        queryClient.setQueryData<ModelOptionsResponse>(modelOptionsQueryKey(profile, null, ownerConnectionId), patch)
      }
    },
    [cacheOwnerConnectionId, cacheProfile, queryClient]
  )

  // One shared model setting per account/profile; agents adopt it at the next turn.
  const applySavedMainModel = useCallback(
    (provider: string, model: string) => {
      if (!cacheProfile || cacheProfile === $activeGatewayProfile.get()) {
        setCurrentModelSource('default')
        setCurrentProvider(provider)
        setCurrentModel(model)
      }

      // Live agents keep streaming with their current runtime until the next turn.
      updateModelOptionsCache(null, provider, model, false)
    },
    [cacheProfile, updateModelOptionsCache]
  )

  // Seed the composer's model state from the profile default. `force` reseeds
  // for a profile swap (the new profile has its own default); otherwise this
  // only fills an EMPTY selection so a user's pick (plain UI state in
  // $currentModel) survives the lifecycle refreshes that fire on boot / fresh
  // draft / session events. A live session owns the footer, so skip entirely.
  const refreshCurrentModel = useCallback(
    async (force = false) => {
      // A forced profile swap opens a new intent epoch; an older in-flight
      // response for a previous profile must stand down when it resolves.
      if (force) {
        profileRefreshEpochRef.current += 1
      }

      const profileRefreshEpoch = profileRefreshEpochRef.current
      const profile = $activeGatewayProfile.get()

      try {
        if ($activeSessionId.get()) {
          return
        }

        // A manual pick stays sticky UNLESS it was removed from the catalog (its
        // model no longer exists on the provider), in which case keeping it would
        // 404 every new chat — fall through to reseed from the profile default.
        // Reads the model-options cache the composer already populated; an
        // unknown/not-yet-loaded catalog conservatively preserves the pick.
        const keepManualPick = () => {
          if (force || !$currentModel.get() || getCurrentModelSource() !== 'manual') {
            return false
          }

          const options = queryClient.getQueryData<ModelOptionsResponse>(
            modelOptionsQueryKey(cacheProfile || $activeGatewayProfile.get(), null, cacheOwnerConnectionId)
          )

          return !manualPickRemoved(options?.providers, $currentProvider.get(), $currentModel.get())
        }

        if (keepManualPick()) {
          return
        }

        // Snapshot the selection generation before awaiting so a picker click
        // that lands while getGlobalModelInfo is in flight wins over this older
        // default — value comparisons alone miss re-selecting the same row.
        const selectionGeneration = getComposerSelectionGeneration()
        const result = await getGlobalModelInfo(profile)

        if (
          profileRefreshEpochRef.current !== profileRefreshEpoch ||
          $activeSessionId.get() ||
          getComposerSelectionGeneration() !== selectionGeneration ||
          keepManualPick()
        ) {
          return
        }

        if (typeof result.model === 'string') {
          setCurrentModel(result.model)
        }

        if (typeof result.provider === 'string') {
          setCurrentProvider(result.provider)
        }

        if (typeof result.model === 'string' || typeof result.provider === 'string') {
          setCurrentModelSource('default')
        }
      } catch {
        // The delayed session.info event still updates this once the agent is ready.
      }
    },
    [cacheOwnerConnectionId, cacheProfile, queryClient]
  )

  // Returns whether the switch was applied so callers can await it before
  // applying follow-up changes. `true` means applied (or deferred/busy-queued
  // for the next turn). `false` means NOT applied — either pending
  // confirmation (warning with Confirm action already shown, pill rolled back)
  // or a real failure (error toast). Callers must NOT treat `false` as a
  // generic failure: for `pending` the gateway intentionally returned
  // `confirm_required` and no error should be surfaced.
  // Every composer writes the account/profile default. Existing agents adopt it
  // before their next turn, without interrupting a response in progress.
  //
  // `selection.sessionId` targets a specific surface (tile). When omitted, the
  // primary `$activeSessionId` is used (overlay / legacy callers). A tile
  // switch must not touch the primary globals — and must not be blocked by a
  // busy primary turn.
  const selectModel = useCallback(
    async (selection: ModelSelection): Promise<boolean> => {
      if (selection.provider === 'moa') {
        notifyError(new Error('统一模型设置请选择实际模型；子智能体模型请在设置中配置。'), copy.modelSwitchFailed)

        return false
      }

      const primaryRuntimeId = $activeSessionId.get()
      const liveSessionId = 'sessionId' in selection ? (selection.sessionId ?? null) : primaryRuntimeId
      const touchesPrimary = !liveSessionId || liveSessionId === primaryRuntimeId

      const prevModel = touchesPrimary ? $currentModel.get() : ($sessionStates.get()[liveSessionId!]?.model ?? '')

      const prevProvider = touchesPrimary
        ? $currentProvider.get()
        : ($sessionStates.get()[liveSessionId!]?.provider ?? '')

      const prevSource = getCurrentModelSource()
      const liveGatewayProfile = cacheProfile || $activeGatewayProfile.get()

      const paintSelection = () => {
        if (touchesPrimary) {
          setCurrentModel(selection.model)
          setCurrentProvider(selection.provider)
          markComposerSelectionManual()
        } else if (liveSessionId) {
          // Optimistic tile paint — session.info will confirm; rollback on error.
          sessionTileDelegate()?.updateSession(liveSessionId, state => ({
            ...state,
            model: selection.model,
            provider: selection.provider
          }))
        }
      }

      const cacheSelection = (provider: string, model: string) => {
        updateModelOptionsCache(liveSessionId, provider, model, true, liveGatewayProfile)
      }

      const rollbackSelection = () => {
        if (touchesPrimary) {
          setCurrentModel(prevModel)
          setCurrentProvider(prevProvider)
          setCurrentModelSource(prevSource)
        } else if (liveSessionId) {
          sessionTileDelegate()?.updateSession(liveSessionId, state => ({
            ...state,
            model: prevModel,
            provider: prevProvider
          }))
        }

        cacheSelection(prevProvider, prevModel)
      }

      paintSelection()
      cacheSelection(selection.provider, selection.model)

      // Every picker, including a fresh draft or a tile, writes the shared setting.
      const scope = ' --global'

      const requestSwitch = (confirmExpensiveModel = false) =>
        requestGateway<ModelSwitchResponse>('config.set', {
          key: 'model',
          value: `${selection.model} --provider ${selection.provider}${scope}`,
          ...(confirmExpensiveModel ? { confirm_expensive_model: true } : {})
        })

      const finishSwitch = (result: ModelSwitchResponse | undefined) => {
        if (touchesPrimary) {
          applySavedMainModel(selection.provider, selection.model)
        }

        // A pick made DURING a turn is queued by the gateway and applied at the
        // next turn start (`deferred`). Re-fetching now would answer with the
        // model still running and repaint the old name over the user's choice —
        // the switch publishes session.info when it lands, and that is what
        // re-syncs every surface.
        if (!result?.deferred) {
          void queryClient.invalidateQueries({
            queryKey: modelOptionsQueryKey(liveGatewayProfile, liveSessionId, cacheOwnerConnectionId)
          })
        }
      }

      try {
        const result = await requestSwitch()

        if (result?.confirm_required) {
          rollbackSelection()
          // ONE shared applier for guarded switches (#95293): the same
          // confirm flow the Bots editor routes through — never fork this
          // logic per surface.
          surfaceModelSwitchConfirm({
            confirmLabel: t.common.confirm,
            confirmMessage: result.confirm_message,
            failureMessage: copy.modelSwitchFailed,
            finish: finishSwitch,
            // Staleness guard — the warning can linger while the user picks
            // a different model or switches sessions. Clicking Confirm must
            // not clobber the newer choice: bail if the live state no longer
            // matches the snapshot this notification was created for.
            isStale: () =>
              touchesPrimary
                ? $activeSessionId.get() !== liveSessionId ||
                  $currentModel.get() !== prevModel ||
                  $currentProvider.get() !== prevProvider
                : !liveSessionId ||
                  $sessionStates.get()[liveSessionId]?.model !== prevModel ||
                  $sessionStates.get()[liveSessionId]?.provider !== prevProvider,
            repaint: () => {
              paintSelection()
              cacheSelection(selection.provider, selection.model)
            },
            requestConfirmed: () => requestSwitch(true),
            rollback: rollbackSelection
          })

          return false
        }

        finishSwitch(result)

        return true
      } catch (err) {
        rollbackSelection()
        notifyError(err, copy.modelSwitchFailed)

        return false
      }
    },
    [
      applySavedMainModel,
      cacheOwnerConnectionId,
      cacheProfile,
      copy.modelSwitchFailed,
      queryClient,
      requestGateway,
      t.common.confirm,
      updateModelOptionsCache
    ]
  )

  return { applySavedMainModel, refreshCurrentModel, selectModel }
}
