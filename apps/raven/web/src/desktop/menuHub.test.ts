import { describe, expect, it } from 'bun:test'
import { MENU_PLAYER_ACTIONS, type MenuPlayerAction } from '@raven/core'
import { createMenuHub } from '@/desktop/menuHub'

describe('createMenuHub', () => {
  it('hands each action to whoever listens until they stop', () => {
    const hub = createMenuHub()
    const heard: MenuPlayerAction[] = []
    const stop = hub.subscribe((action) => heard.push(action))
    hub.emit(MENU_PLAYER_ACTIONS.togglePlay)
    stop()
    hub.emit(MENU_PLAYER_ACTIONS.next)
    expect(heard).toEqual([MENU_PLAYER_ACTIONS.togglePlay])
  })
})
