import { useCallback } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'

import type { ChatInputAreaHandle } from '@/components/Chat/ChatInputArea'
import type { ConverterPipelineStage, MessageAttachment, PieceConversion } from '@/types'

export interface ChatDraftRestore {
  value: string
  attachments: MessageAttachment[]
  textMetadata?: Record<string, unknown>
  conversions: Record<string, PieceConversion>
  pipelines?: Record<string, ConverterPipelineStage[]>
}

export interface ChatDraftConverters {
  restore: (
    text: string,
    attachments: MessageAttachment[],
    conversions: Record<string, PieceConversion>,
    pipelines?: Record<string, ConverterPipelineStage[]>,
  ) => void
  clearAll: () => void
}

export interface ChatDraftInput {
  /** Puts a saved prompt back into the composer state, the converter state and the input box, in that order. */
  restore(draft: ChatDraftRestore): void
  /** Empties the input box, the composer state and every converter selection. */
  clear(): void
  getRevision(): number | undefined
  getTextMetadata(): Record<string, unknown> | undefined
  focus(): void
}

/** Small adapter over the chat input box so restore and clear sequences stay identical everywhere. */
export function useChatDraftInput(
  inputBoxRef: RefObject<ChatInputAreaHandle | null>,
  converters: ChatDraftConverters,
  setChatInputText: Dispatch<SetStateAction<string>>,
  setDraftAttachments: Dispatch<SetStateAction<MessageAttachment[]>>,
): ChatDraftInput {
  const { restore: restoreConversions, clearAll } = converters

  const restore = useCallback((draft: ChatDraftRestore): void => {
    setChatInputText(draft.value)
    setDraftAttachments(draft.attachments)
    restoreConversions(draft.value, draft.attachments, draft.conversions, draft.pipelines)
    inputBoxRef.current?.restoreDraft(draft.value, draft.attachments, draft.textMetadata)
  }, [inputBoxRef, restoreConversions, setChatInputText, setDraftAttachments])

  const clear = useCallback((): void => {
    inputBoxRef.current?.restoreDraft('', [])
    setChatInputText('')
    setDraftAttachments([])
    clearAll()
  }, [clearAll, inputBoxRef, setChatInputText, setDraftAttachments])

  const getRevision = useCallback((): number | undefined => inputBoxRef.current?.getDraftRevision(), [inputBoxRef])
  const getTextMetadata = useCallback(
    (): Record<string, unknown> | undefined => inputBoxRef.current?.getTextMetadata(), [inputBoxRef],
  )
  const focus = useCallback((): void => { inputBoxRef.current?.focus() }, [inputBoxRef])

  return { restore, clear, getRevision, getTextMetadata, focus }
}
