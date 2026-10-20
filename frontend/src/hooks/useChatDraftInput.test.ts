import { renderHook } from '@testing-library/react'

import type { ChatInputAreaHandle } from '@/components/Chat/ChatInputArea'
import type { MessageAttachment } from '@/types'

import { useChatDraftInput } from './useChatDraftInput'

function setup() {
  const calls: string[] = []
  const inputBox: ChatInputAreaHandle = {
    addAttachment: jest.fn(),
    setText: jest.fn(),
    restoreDraft: jest.fn(() => { calls.push('restoreDraft') }),
    focus: jest.fn(),
    getDraftRevision: jest.fn(() => 7),
    getTextMetadata: jest.fn(() => ({ source: 'paste' })),
  }
  const inputBoxRef = { current: inputBox }
  const converters = {
    restore: jest.fn(() => { calls.push('restoreConversions') }),
    clearAll: jest.fn(() => { calls.push('clearAll') }),
  }
  const setChatInputText = jest.fn(() => { calls.push('setText') })
  const setDraftAttachments = jest.fn(() => { calls.push('setAttachments') })
  const { result } = renderHook(() => useChatDraftInput(inputBoxRef, converters, setChatInputText, setDraftAttachments))
  return { result, inputBox, inputBoxRef, converters, setChatInputText, setDraftAttachments, calls }
}

const attachment: MessageAttachment = { type: 'image', name: 'a.png', url: 'blob:a', mimeType: 'image/png', size: 1 }

describe('useChatDraftInput', () => {
  it('restores composer state, converters and the input box in order', () => {
    const { result, inputBox, converters, setChatInputText, setDraftAttachments, calls } = setup()
    result.current.restore({
      value: 'hello', attachments: [attachment], textMetadata: { k: 1 }, conversions: {}, pipelines: { text: [] },
    })
    expect(setChatInputText).toHaveBeenCalledWith('hello')
    expect(setDraftAttachments).toHaveBeenCalledWith([attachment])
    expect(converters.restore).toHaveBeenCalledWith('hello', [attachment], {}, { text: [] })
    expect(inputBox.restoreDraft).toHaveBeenCalledWith('hello', [attachment], { k: 1 })
    expect(calls).toEqual(['setText', 'setAttachments', 'restoreConversions', 'restoreDraft'])
    expect(inputBox.focus).not.toHaveBeenCalled()
  })

  it('clears the input box, the composer and every converter selection', () => {
    const { result, inputBox, calls } = setup()
    result.current.clear()
    expect(inputBox.restoreDraft).toHaveBeenCalledWith('', [])
    expect(calls).toEqual(['restoreDraft', 'setText', 'setAttachments', 'clearAll'])
  })

  it('reads the revision and text metadata and focuses the input box', () => {
    const { result, inputBox } = setup()
    expect(result.current.getRevision()).toBe(7)
    expect(result.current.getTextMetadata()).toEqual({ source: 'paste' })
    result.current.focus()
    expect(inputBox.focus).toHaveBeenCalled()
  })

  it('tolerates a missing input box', () => {
    const { result, inputBoxRef } = setup()
    ;(inputBoxRef as { current: ChatInputAreaHandle | null }).current = null
    expect(result.current.getRevision()).toBeUndefined()
    expect(() => { result.current.focus(); result.current.clear() }).not.toThrow()
  })
})
