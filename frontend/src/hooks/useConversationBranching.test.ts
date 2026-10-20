import { act, renderHook } from '@testing-library/react'

import { attacksApi } from '@/services/api'
import { deferred } from '@/test-utils/deferred'
import type { AddMessageResponse, BackendMessage, ConversationMessagesResponse, Message, TargetInstance } from '@/types'
import { editorTargetDisabledReason } from '@/utils/conversationDraft'

import type { ChatDraftInput } from './useChatDraftInput'
import { useConversationBranching } from './useConversationBranching'
import type { UseConversationBranchingOptions } from './useConversationBranching'
import { useConversationSave } from './useConversationSave'

jest.mock('@/services/api', () => ({
  attacksApi: {
    getMessages: jest.fn(), createConversation: jest.fn(), changeMainConversation: jest.fn(), createAttack: jest.fn(),
  },
}))
jest.mock('./useConversationSave', () => ({ useConversationSave: jest.fn() }))
jest.mock('@/utils/messageMapper', () => ({
  backendMessagesToFrontend: jest.fn((messages: BackendMessage[]) => messages.map((m) => ({
    role: m.role, content: String(m.turn_number), timestamp: '',
  }))),
}))
jest.mock('@/utils/conversationDraft', () => ({
  draftDataTypes: jest.fn(() => ['text']),
  editorTargetDisabledReason: jest.fn(() => undefined),
  toConversationDraft: jest.fn((messages: BackendMessage[]) => messages.map((m) => ({
    id: `m${m.turn_number}`, role: m.role, pieces: [],
  }))),
}))

const save = jest.fn()
const target = { target_registry_name: 'target-a' } as TargetInstance

function transcript(turns: number[]): ConversationMessagesResponse {
  return {
    conversation_id: 'main',
    messages: turns.map((turn) => ({ turn_number: turn, role: turn % 2 ? 'user' : 'assistant', message_pieces: [] }) as unknown as BackendMessage),
    target_response_status: null,
  }
}

function saved(attackId: string, conversationId: string): AddMessageResponse {
  return {
    attack: { attack_result_id: attackId, objective: 'Objective' } as AddMessageResponse['attack'],
    messages: { conversation_id: conversationId, messages: [], target_response_status: null },
  }
}

interface Harness {
  viewed: string | null
  revision: number
  launch: { generation: string; ready: boolean; defaultsReady: boolean }
}

function setup(overrides: {
  attack?: Partial<UseConversationBranchingOptions['attack']>
  locks?: Partial<UseConversationBranchingOptions['locks']>
  recovery?: Partial<UseConversationBranchingOptions['recovery']>
  messages?: Message[]
} = {}) {
  const harness: Harness = { viewed: 'main', revision: 1, launch: { generation: 'g1', ready: true, defaultsReady: true } }
  const draftInput: ChatDraftInput = {
    restore: jest.fn(), clear: jest.fn(), getRevision: jest.fn(() => harness.revision),
    getTextMetadata: jest.fn(), focus: jest.fn(),
  }
  const inputBox = {
    addAttachment: jest.fn(), setText: jest.fn(), restoreDraft: jest.fn(), focus: jest.fn(),
    getDraftRevision: jest.fn(() => harness.revision), getTextMetadata: jest.fn(),
  }
  const editor = { draft: null, begin: jest.fn(), discard: jest.fn() } as unknown as UseConversationBranchingOptions['editor']
  const callbacks = {
    onSelectConversation: jest.fn(), onConversationCreated: jest.fn(), onAttackChange: jest.fn(),
    onEditorBegun: jest.fn(), openPanel: jest.fn(), bumpPanelRefresh: jest.fn(), navigate: jest.fn(),
  }
  const setMessages = jest.fn()
  const markLoaded = jest.fn()
  const recovery = {
    recoverableSend: undefined, recoverProcessingError: jest.fn(() => Promise.resolve()),
    restoreRecoverableDraft: jest.fn(), ...overrides.recovery,
  }
  const options = (): UseConversationBranchingOptions => ({
    attack: {
      attackResultId: 'attack', objective: 'Objective', currentObjective: 'Objective', labels: { op: 'me' },
      targetResolutionStatus: 'resolved', activeTarget: target,
      newAttackContext: { generation: 'g1', ready: true, labels: {} } as unknown as UseConversationBranchingOptions['attack']['newAttackContext'],
      ...overrides.attack,
    },
    view: {
      viewedConversationId: 'main', getViewedConversationId: () => harness.viewed,
      messages: overrides.messages ?? [], setMessages, markLoaded,
    },
    locks: {
      isMutationLocked: false, isSending: false, isBusyLoading: false, runtimeReady: true, defaultsReady: true,
      runtimeGeneration: 'g1', getLaunchState: () => harness.launch, ...overrides.locks,
    },
    recovery,
    editor,
    draftInput,
    inputBoxRef: { current: inputBox },
    composerDraftMessage: () => null,
    callbacks,
  })
  const hook = renderHook(() => useConversationBranching(options()))
  return { hook, harness, draftInput, inputBox, editor, callbacks, setMessages, markLoaded, recovery }
}

describe('useConversationBranching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(useConversationSave).mockReturnValue({ save, saving: false })
    jest.mocked(editorTargetDisabledReason).mockReturnValue(undefined)
    jest.mocked(attacksApi.getMessages).mockResolvedValue(transcript([1, 2, 3, 4]))
  })

  it('creates a new conversation with an empty request and opens the panel unless narrow', async () => {
    jest.mocked(attacksApi.createConversation).mockResolvedValue({ conversation_id: 'new' } as never)
    const { hook, callbacks } = setup()
    let created = false
    await act(async () => { created = await hook.result.current.newConversation() })
    expect(created).toBe(true)
    expect(attacksApi.createConversation).toHaveBeenCalledWith('attack', {})
    expect(callbacks.onSelectConversation).toHaveBeenCalledWith('new')
    expect(callbacks.openPanel).toHaveBeenCalledWith('unlessNarrow')
  })

  it('appends an assistant error bubble when a new conversation cannot be created', async () => {
    jest.mocked(attacksApi.createConversation).mockRejectedValue(new Error('boom'))
    const { hook, setMessages } = setup()
    await act(async () => { await hook.result.current.newConversation() })
    const update = setMessages.mock.calls[0][0] as (previous: Message[]) => Message[]
    const [bubble] = update([])
    expect(bubble.role).toBe('assistant')
    expect(bubble.error?.description).toContain('Could not create a new conversation.')
  })

  it('does not create a conversation while mutations are locked', async () => {
    const { hook } = setup({ locks: { isMutationLocked: true } })
    await act(async () => { expect(await hook.result.current.newConversation()).toBe(false) })
    expect(attacksApi.createConversation).not.toHaveBeenCalled()
  })

  it('copies text and attachments into the input box', () => {
    const attachment = { type: 'image', name: 'a', url: 'u', mimeType: 'image/png' } as const
    const { hook, inputBox } = setup({ messages: [{ role: 'user', content: 'hi', timestamp: '', attachments: [attachment] }] })
    hook.result.current.copyToInput(0)
    hook.result.current.copyToInput(5)
    expect(inputBox.setText).toHaveBeenCalledTimes(1)
    expect(inputBox.setText).toHaveBeenCalledWith('hi')
    expect(inputBox.addAttachment).toHaveBeenCalledWith(attachment)
  })

  it('changes the main conversation and refreshes the panel, logging failures', async () => {
    jest.mocked(attacksApi.changeMainConversation).mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('no'))
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { hook, callbacks } = setup()
    await act(async () => { await hook.result.current.changeMainConversation('c2') })
    expect(callbacks.bumpPanelRefresh).toHaveBeenCalledTimes(1)
    await act(async () => { await hook.result.current.changeMainConversation('c3') })
    expect(error).toHaveBeenCalledWith('Failed to change main conversation:', expect.any(Error))
    error.mockRestore()
  })

  it('copies to a new conversation in the same attack', async () => {
    save.mockResolvedValue(saved('attack', 'copy'))
    const { hook, callbacks } = setup()
    await act(async () => { await hook.result.current.copyConversation(1, 'same_attack') })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      sourceAttackId: 'attack', sourceConversationId: 'main', target, messages: [expect.anything(), expect.anything()],
    }), 'same_attack')
    expect(callbacks.onSelectConversation).toHaveBeenCalledWith('copy')
    expect(callbacks.openPanel).toHaveBeenCalledWith('always')
    expect(callbacks.bumpPanelRefresh).toHaveBeenCalled()
  })

  it('copies to a new attack and reports the created attack', async () => {
    save.mockResolvedValue(saved('attack-2', 'copy'))
    const { hook, callbacks } = setup()
    await act(async () => { await hook.result.current.copyConversation(3, 'new_attack') })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ target }), 'new_attack')
    expect(callbacks.onConversationCreated).toHaveBeenCalledWith('attack-2', 'copy', 'Objective', target)
    expect(callbacks.onAttackChange).toHaveBeenCalled()
  })

  it('copies to a technique without a target and navigates', async () => {
    save.mockResolvedValue(saved('attack-2', 'tech'))
    const { hook, callbacks } = setup()
    await act(async () => { await hook.result.current.copyConversation(0, 'technique') })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ target: null }), 'new_attack')
    expect(callbacks.navigate).toHaveBeenCalledWith('/scanner/technique.execute?prepended_conversation_id=tech')
    expect(callbacks.onConversationCreated).not.toHaveBeenCalled()
  })

  it('routes the failed prompt to recovery when copying into the same attack', async () => {
    const { hook, recovery } = setup({ recovery: { recoverableSend: { failedRequestMessageIndex: 2, historyCutoffIndex: 1 } } })
    await act(async () => { await hook.result.current.copyConversation(2, 'same_attack') })
    expect(recovery.recoverProcessingError).toHaveBeenCalled()
    expect(attacksApi.getMessages).not.toHaveBeenCalled()
  })

  it('cuts the failed prompt history at the cutoff and restores the draft in a new attack', async () => {
    save.mockResolvedValue(saved('attack-2', 'copy'))
    const { hook, recovery } = setup({ recovery: { recoverableSend: { failedRequestMessageIndex: 2, historyCutoffIndex: 2 } } })
    await act(async () => { await hook.result.current.copyConversation(2, 'new_attack') })
    expect(save.mock.calls[0][0].messages).toHaveLength(2)
    expect(recovery.restoreRecoverableDraft).toHaveBeenCalledWith('copy')
  })

  it('falls back to createAttack when nothing in the failed prompt history is copyable', async () => {
    jest.mocked(editorTargetDisabledReason).mockReturnValue('incompatible')
    jest.mocked(attacksApi.createAttack).mockResolvedValue({ attack_result_id: 'fresh', conversation_id: 'c' } as never)
    const { hook, callbacks, recovery } = setup({ recovery: { recoverableSend: { failedRequestMessageIndex: 2, historyCutoffIndex: 2 } } })
    await act(async () => { await hook.result.current.copyConversation(2, 'new_attack') })
    expect(save).not.toHaveBeenCalled()
    expect(attacksApi.createAttack).toHaveBeenCalledWith({ target_registry_name: 'target-a', name: 'Objective', labels: { op: 'me' } })
    expect(callbacks.onConversationCreated).toHaveBeenCalledWith('fresh', 'c', 'Objective', target)
    expect(recovery.restoreRecoverableDraft).toHaveBeenCalledWith('c')
    expect(callbacks.openPanel).toHaveBeenCalledWith('always')
  })

  it('discards the copy result after navigating away', async () => {
    const pending = deferred<AddMessageResponse>()
    save.mockReturnValue(pending.promise)
    const { hook, harness, callbacks } = setup()
    let copy!: Promise<void>
    act(() => { copy = hook.result.current.copyConversation(1, 'same_attack') })
    await act(async () => { await Promise.resolve() })
    harness.viewed = 'other'
    await act(async () => { pending.resolve(saved('attack', 'copy')); await copy })
    expect(callbacks.onSelectConversation).not.toHaveBeenCalled()
    expect(hook.result.current.isLoadingEdit).toBe(false)
  })

  it('blocks only same-attack copies while mutations are locked', async () => {
    save.mockResolvedValue(saved('attack-2', 'copy'))
    const { hook } = setup({ locks: { isMutationLocked: true } })
    await act(async () => { await hook.result.current.copyConversation(1, 'same_attack') })
    expect(save).not.toHaveBeenCalled()
    await act(async () => { await hook.result.current.copyConversation(1, 'new_attack') })
    expect(save).toHaveBeenCalledWith(expect.anything(), 'new_attack')
  })

  it('does not start new-attack copies before defaults are ready', async () => {
    const { hook } = setup({ locks: { defaultsReady: false } })
    await act(async () => { await hook.result.current.copyConversation(1, 'new_attack') })
    expect(attacksApi.getMessages).not.toHaveBeenCalled()
  })

  it('reports a runtime change that happens while the source loads', async () => {
    const { hook, harness } = setup()
    const load = deferred<ConversationMessagesResponse>()
    jest.mocked(attacksApi.getMessages).mockReturnValue(load.promise)
    let copy!: Promise<void>
    act(() => { copy = hook.result.current.copyConversation(1, 'new_attack') })
    harness.launch = { generation: 'g2', ready: true, defaultsReady: true }
    await act(async () => { load.resolve(transcript([1, 2])); await copy })
    expect(save).not.toHaveBeenCalled()
    expect(hook.result.current.editorError).toContain('Runtime or default labels changed')
  })

  it('ignores a second copy while the first is in flight', async () => {
    const pending = deferred<AddMessageResponse>()
    save.mockReturnValue(pending.promise)
    const { hook } = setup()
    let first!: Promise<void>
    act(() => { first = hook.result.current.copyConversation(1, 'same_attack') })
    await act(async () => { await hook.result.current.copyConversation(1, 'same_attack') })
    expect(attacksApi.getMessages).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(saved('attack', 'copy')); await first })
  })

  it('begins editing with the source transcript and hands back to ChatWindow', async () => {
    const { hook, editor, callbacks } = setup()
    await act(async () => { await hook.result.current.beginEdit() })
    expect(editor.begin).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'Objective', sourceConversationId: 'main', sourceAttackId: 'attack', target, labels: { op: 'me' },
    }))
    expect(callbacks.onEditorBegun).toHaveBeenCalled()
  })

  it('applies a saved editor response to the transcript and selects the conversation', () => {
    const { hook, editor, callbacks, markLoaded } = setup()
    act(() => { hook.result.current.onEditorSaved(saved('attack', 'edited')) })
    expect(editor.discard).toHaveBeenCalled()
    expect(markLoaded).toHaveBeenCalledWith('edited')
    expect(callbacks.onSelectConversation).toHaveBeenCalledWith('edited')
    expect(hook.result.current.editorNotice?.message).toBe('Conversation saved.')
  })
})
