import { afterEach, describe, expect, it } from 'bun:test'
import { localOrMemoryStorage } from '@/stores/browserStorage'
import { STORE_KEYS } from '@/stores/storage'
import { useToasts } from '@/stores/toasts'

describe('the toasts', () => {
  afterEach(() => {
    useToasts.setState({ toasts: [] })
  })

  it('keeps the next id, but never a toast, for the next launch', () => {
    useToasts.getState().show('Drop a video file to play it.')
    const stored = localOrMemoryStorage().getItem(STORE_KEYS.toasts) ?? ''
    expect(stored).not.toContain('Drop a video file to play it.')
    expect(JSON.parse(stored)).toEqual({
      state: { nextId: useToasts.getState().nextId },
      version: 0,
    })
  })
})
