import { useCallback, useEffect, useState, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { NavigateFunction } from 'react-router'

import type { ChatInputAreaHandle } from '@/components/Chat/ChatInputArea'
import { CHAT_NOTICE_FADE_DURATION_MS } from '@/components/Chat/ChatWindow.styles'
import { attacksApi } from '@/services/api'
import { toApiError } from '@/services/errors'
import type {
  AddMessageResponse,
  AttackSummary,
  AttackTargetResolutionStatus,
  BackendMessage,
  ConversationDraftMessage,
  CreateConversationRequest,
  Message,
  NewAttackContext,
  TargetInstance,
} from '@/types'
import { generateClientId } from '@/utils/clientId'
import { draftDataTypes, editorTargetDisabledReason, toConversationDraft } from '@/utils/conversationDraft'
import { backendMessagesToFrontend } from '@/utils/messageMapper'

import type { useConversationDraft } from './useConversationDraft'
import type { ChatDraftInput } from './useChatDraftInput'
import { useConversationSave } from './useConversationSave'

export const CHAT_NOTICE_VISIBLE_DURATION_MS = 5_000

export interface ChatInfoNotice {
  readonly id: string
  readonly message: string
  readonly fading: boolean
}

export type ConversationCopyDestination = 'same_attack' | 'new_attack' | 'technique'

export interface BranchingRecoverableSend {
  failedRequestMessageIndex: number
  historyCutoffIndex: number
}

export interface LaunchState {
  generation: string
  ready: boolean
  defaultsReady: boolean
}

export interface UseConversationBranchingOptions {
  attack: {
    attackResultId: string | null
    objective: string
    currentObjective: string
    labels?: Record<string, string>
    targetResolutionStatus: AttackTargetResolutionStatus
    activeTarget: TargetInstance | null
    newAttackContext: NewAttackContext
  }
  view: {
    viewedConversationId: string | null
    getViewedConversationId: () => string | null
    messages: Message[]
    setMessages: Dispatch<SetStateAction<Message[]>>
    markLoaded: (conversationId: string) => void
  }
  locks: {
    isMutationLocked: boolean
    isSending: boolean
    /** Attack, messages, or an awaited conversation load. */
    isBusyLoading: boolean
    runtimeReady: boolean
    defaultsReady: boolean
    runtimeGeneration: string
    getLaunchState: () => LaunchState
  }
  /** Send-owned recovery, passed in until the send workflow moves out of ChatWindow. */
  recovery: {
    recoverableSend: BranchingRecoverableSend | undefined
    recoverProcessingError: () => Promise<void>
    restoreRecoverableDraft: (destinationConversationId: string) => void
  }
  editor: ReturnType<typeof useConversationDraft>
  draftInput: ChatDraftInput
  inputBoxRef: { readonly current: ChatInputAreaHandle | null }
  /** The unsent composer prompt, appended as a pending user message when editing begins. */
  composerDraftMessage: () => ConversationDraftMessage | null
  callbacks: {
    onSelectConversation: (conversationId: string) => void
    onConversationCreated: (
      attackResultId: string, conversationId: string, objective?: string, target?: TargetInstance | null,
    ) => void
    onAttackChange?: (attack: AttackSummary) => void
    onEditorBegun: () => void
    openPanel: (mode: 'always' | 'unlessNarrow') => void
    bumpPanelRefresh: () => void
    navigate: NavigateFunction
  }
}

/**
 * Copy, branch, new-conversation and editor-entry workflows for ChatWindow.
 * The logic is moved verbatim; every await is followed by the same stale-view checks as before.
 */
export function useConversationBranching({
  attack, view, locks, recovery, editor, draftInput, inputBoxRef, composerDraftMessage, callbacks,
}: UseConversationBranchingOptions) {
  const { attackResultId, objective, currentObjective, labels, targetResolutionStatus, activeTarget } = attack
  const { viewedConversationId, getViewedConversationId, messages, setMessages, markLoaded } = view
  const { isMutationLocked, isSending, isBusyLoading, runtimeReady, defaultsReady, runtimeGeneration, getLaunchState } = locks
  const { recoverableSend, recoverProcessingError, restoreRecoverableDraft } = recovery
  const { onSelectConversation, onConversationCreated, onAttackChange, onEditorBegun, openPanel, bumpPanelRefresh, navigate } = callbacks
  const editDraft = editor.draft
  const editorTarget = editDraft?.target ?? null

  const [isLoadingEdit, setIsLoadingEdit] = useState(false)
  const copyingRef = useRef(false)
  const copySave = useConversationSave(attack.newAttackContext)
  const [editorNotice, setEditorNoticeState] = useState<ChatInfoNotice | null>(null)
  const setEditorNotice = useCallback((message: string | null): void => {
    setEditorNoticeState(message === null ? null : { id: generateClientId(), message, fading: false })
  }, [])
  const noticeId = editorNotice?.id
  useEffect(() => {
    if (!noticeId) return
    const fade = window.setTimeout(() => {
      setEditorNoticeState((current: ChatInfoNotice | null) => current?.id === noticeId
        ? { ...current, fading: true } : current)
    }, CHAT_NOTICE_VISIBLE_DURATION_MS)
    const dismiss = window.setTimeout(() => {
      setEditorNoticeState((current: ChatInfoNotice | null) => current?.id === noticeId ? null : current)
    }, CHAT_NOTICE_VISIBLE_DURATION_MS + CHAT_NOTICE_FADE_DURATION_MS)
    return () => { window.clearTimeout(fade); window.clearTimeout(dismiss) }
  }, [noticeId])
  const [editorError, setEditorError] = useState<string | null>(null)

  const appendConversationCreationError = useCallback((error: unknown): void => {
    const apiError = toApiError(error)
    setMessages((previousMessages) => [
      ...previousMessages,
      {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        error: {
          type: 'unknown',
          description: `Could not create a new conversation. ${apiError.detail}`,
        },
      },
    ])
  }, [setMessages])

  const createAndSelectConversation = useCallback(async (
    request: CreateConversationRequest,
  ): Promise<boolean> => {
    if (!attackResultId || isMutationLocked) { return false }

    try {
      const response = await attacksApi.createConversation(attackResultId, request)
      onSelectConversation(response.conversation_id)
      openPanel('unlessNarrow')
      return true
    } catch (err) {
      appendConversationCreationError(err)
      return false
    }
  }, [
    appendConversationCreationError,
    attackResultId,
    isMutationLocked,
    onSelectConversation,
    openPanel,
  ])

  const newConversation = useCallback(
    (): Promise<boolean> => createAndSelectConversation({}),
    [createAndSelectConversation],
  )

  const copyMessageToInput = useCallback((message: Message): void => {
    const inputBox = inputBoxRef.current
    if (!inputBox) { return }

    if (message.content) {
      inputBox.setText(message.content)
    }
    for (const attachment of message.attachments ?? []) {
      inputBox.addAttachment(attachment)
    }
  }, [inputBoxRef])

  /** Copy the clicked message's content/attachments into the current conversation's input box. */
  const copyToInput = useCallback((messageIndex: number) => {
    const msg = messages[messageIndex]
    if (!msg) { return }
    copyMessageToInput(msg)
  }, [copyMessageToInput, messages])

  const changeMainConversation = useCallback(async (convId: string) => {
    if (
      !attackResultId
      || isMutationLocked
    ) {
      return
    }

    try {
      await attacksApi.changeMainConversation(attackResultId, convId)
      bumpPanelRefresh()
    } catch (err) {
      console.error('Failed to change main conversation:', err)
    }
  }, [
    attackResultId,
    bumpPanelRefresh,
    isMutationLocked,
  ])

  const beginEdit = async (
    target: TargetInstance | null = activeTarget,
  ): Promise<void> => {
    if (editDraft || isSending || isLoadingEdit || isBusyLoading) return
    const sourceId = viewedConversationId
    setIsLoadingEdit(true)
    setEditorError(null)
    setEditorNotice(null)
    try {
      const source = attackResultId && sourceId ? await attacksApi.getMessages(attackResultId, sourceId) : null
      if (sourceId !== getViewedConversationId()) return
      const sourceMessages = source?.messages ?? []
      const draftMessages = toConversationDraft(sourceMessages)
      const pendingPrompt = composerDraftMessage()
      if (pendingPrompt) {
        draftMessages.push(pendingPrompt)
      }
      editor.begin({
        messages: draftMessages, objective: currentObjective,
        initialObjective: currentObjective, sourceConversationId: sourceId,
        sourceAttackId: attackResultId, target, labels,
      })
      onEditorBegun()
    } catch (error) {
      setEditorError(toApiError(error).detail)
    } finally {
      setIsLoadingEdit(false)
    }
  }

  const onEditorSaved = (response: AddMessageResponse, savedTarget?: TargetInstance | null): void => {
    editor.discard()
    setEditorNotice('Conversation saved.')
    setMessages(backendMessagesToFrontend(response.messages.messages))
    markLoaded(response.messages.conversation_id)
    if (response.attack.attack_result_id === attackResultId) {
      onSelectConversation(response.messages.conversation_id)
    } else {
      onConversationCreated(response.attack.attack_result_id, response.messages.conversation_id, response.attack.objective, savedTarget ?? editorTarget)
    }

    onAttackChange?.(response.attack)
    bumpPanelRefresh()
  }

  const copyConversation = async (
    messageIndex: number, destination: ConversationCopyDestination,
  ): Promise<void> => {
    if (!attackResultId || !viewedConversationId || copyingRef.current || isSending || isLoadingEdit) return
    if (destination === 'same_attack' && isMutationLocked) return
    if (destination !== 'same_attack' && (!runtimeReady || !defaultsReady)) return
    if (destination === 'same_attack' && recoverableSend
      && messageIndex === recoverableSend.failedRequestMessageIndex) {
      await recoverProcessingError()
      return
    }
    const sourceId = viewedConversationId
    const draftRevision = draftInput.getRevision()
    copyingRef.current = true
    setIsLoadingEdit(true)
    setEditorError(null)
    setEditorNotice(null)
    try {
      const source = await attacksApi.getMessages(attackResultId, sourceId)
      const launchState = getLaunchState()
      if (destination !== 'same_attack' && (
        launchState.generation !== runtimeGeneration
        || !launchState.ready || !launchState.defaultsReady
      )) {
        throw new Error('Runtime or default labels changed while loading this conversation. Retry after default labels finish loading.')
      }
      const isFailedPrompt = destination === 'new_attack' && recoverableSend && messageIndex === recoverableSend.failedRequestMessageIndex
      const sourceMessages = isFailedPrompt
        ? source.messages.filter((message: BackendMessage) => message.turn_number <= recoverableSend.historyCutoffIndex)
        : source.messages.slice(0, messageIndex + 1)
      let copiedMessages = toConversationDraft(sourceMessages)
      if (isFailedPrompt && activeTarget
        && editorTargetDisabledReason(activeTarget, draftDataTypes(copiedMessages), copiedMessages)) {
        copiedMessages = []
      }
      if (destination === 'same_attack' && targetResolutionStatus !== 'unbound' && activeTarget) {
        const reason = editorTargetDisabledReason(activeTarget, draftDataTypes(copiedMessages), copiedMessages)
        if (reason) throw new Error(reason)
      }
      let target = activeTarget
      if (destination === 'technique' || (destination === 'same_attack' && targetResolutionStatus === 'unbound')) {
        target = null
      } else if (destination === 'new_attack' && activeTarget && !isFailedPrompt
        && editorTargetDisabledReason(activeTarget, draftDataTypes(copiedMessages), copiedMessages)) {
        target = null
      }
      if (isFailedPrompt && copiedMessages.length === 0) {
        const response = await attacksApi.createAttack({
          target_registry_name: target?.target_registry_name,
          name: objective || undefined,
          labels,
        })
        if (getViewedConversationId() !== sourceId || draftInput.getRevision() !== draftRevision) return
        onConversationCreated(response.attack_result_id, response.conversation_id, objective, target)
        restoreRecoverableDraft(response.conversation_id)
        openPanel('always')
        bumpPanelRefresh()
        return
      }
      const response = await copySave.save({
        sourceAttackId: attackResultId,
        sourceConversationId: sourceId,
        initialObjective: objective,
        objective,
        target,
        labels,
        messages: copiedMessages,
      }, destination === 'same_attack' ? 'same_attack' : 'new_attack')
      if (getViewedConversationId() !== sourceId) return
      if (destination === 'technique') {
        const params = new URLSearchParams({ prepended_conversation_id: response.messages.conversation_id })
        navigate(`/scanner/technique.execute?${params.toString()}`)
        return
      }
      if (isFailedPrompt && draftInput.getRevision() !== draftRevision) return
      if (destination === 'same_attack') onSelectConversation(response.messages.conversation_id)
      else onConversationCreated(response.attack.attack_result_id, response.messages.conversation_id, response.attack.objective, target)
      onAttackChange?.(response.attack)
      if (isFailedPrompt) restoreRecoverableDraft(response.messages.conversation_id)
      openPanel('always')
      bumpPanelRefresh()
    } catch (error) {
      if (getViewedConversationId() === sourceId) setEditorError(toApiError(error).detail)
    } finally {
      copyingRef.current = false
      setIsLoadingEdit(false)
    }
  }

  return {
    isLoadingEdit,
    setIsLoadingEdit,
    editorError,
    setEditorError,
    editorNotice,
    setEditorNotice,
    appendConversationCreationError,
    newConversation,
    copyToInput,
    copyConversation,
    changeMainConversation,
    beginEdit,
    onEditorSaved,
  }
}
