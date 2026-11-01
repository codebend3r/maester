import { beforeEach, describe, expect, it } from 'bun:test'

import { useTouchMenu } from '@/stores/touchMenu'

describe('useTouchMenu', () => {
  beforeEach(() => useTouchMenu.setState({ isOpen: false }))

  it('starts shut, opens and shuts again', () => {
    expect(useTouchMenu.getState().isOpen).toBe(false)
    useTouchMenu.getState().open()
    expect(useTouchMenu.getState().isOpen).toBe(true)
    useTouchMenu.getState().close()
    expect(useTouchMenu.getState().isOpen).toBe(false)
  })
})
