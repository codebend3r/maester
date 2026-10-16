import { describe, expect, it, mock } from 'bun:test'
import type { PlayerAction } from '@raven/ui'
import { createMenuHub } from '@/renderer/desktop/menuHub'
import { isPlayState, playerActionFor, servicesFor } from '@/renderer/PlayPage/playerServices'
import { fakeClient } from '@/renderer/test/render'
import type { LocalFile, MenuPlayerAction } from '@/shared/protocol'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const FILE: LocalFile = { fileId: A, label: 'Clip 01', folder: 'Clips', resumeAt: 42, next: null }

const setup = (file: LocalFile = FILE) => {
  const client = fakeClient()
  const menu = createMenuHub()
  return { client, menu, services: servicesFor({ file, client, menu }) }
}

describe('playerActionFor', () => {
  const table: Array<[MenuPlayerAction, PlayerAction | null]> = [
    ['togglePlay', { type: 'togglePlay' }],
    ['skipBack', { type: 'seekBy', seconds: -10 }],
    ['skipForward', { type: 'seekBy', seconds: 10 }],
    ['showShortcuts', { type: 'showShortcuts' }],
    ['next', null],
  ]
  it.each(table)('maps %s', (action, expected) => {
    expect(playerActionFor(action)).toEqual(expected)
  })
})

describe('servicesFor', () => {
  it('describes the title with no next video', () => {
    expect(setup().services.title).toEqual({
      label: 'Clip 01',
      duration: null,
      resumeAt: 42,
      backTo: '/',
      next: null,
    })
  })

  it('links the next video with its queue', () => {
    const { services } = setup({ ...FILE, next: { fileId: B, label: 'Clip 02', queue: [C] } })
    expect(services.title.next).toEqual({
      to: `/play/${B}`,
      state: { queue: [C] },
      label: 'Clip 02',
    })
  })

  it('has no poster, no escape action and no start report', () => {
    const { services, client } = setup()
    expect(services.posterUrl).toBeNull()
    expect(services.escape).toBeNull()
    services.progress.started()
    expect(client.request).not.toHaveBeenCalled()
  })

  it('saves the position with the length it was told', () => {
    const { services, client } = setup()
    services.progress.duration?.(30)
    services.progress.save(12)
    services.progress.left(20)
    expect(client.request).toHaveBeenNthCalledWith(1, {
      type: 'savePosition',
      fileId: A,
      position: 12,
      duration: 30,
    })
    expect(client.request).toHaveBeenNthCalledWith(2, {
      type: 'savePosition',
      fileId: A,
      position: 20,
      duration: 30,
    })
  })

  it('saves a null length before the engine reports one', () => {
    const { services, client } = setup()
    services.progress.save(12)
    expect(client.request).toHaveBeenCalledWith({
      type: 'savePosition',
      fileId: A,
      position: 12,
      duration: null,
    })
  })

  it('forwards the menu actions the player understands and drops the rest', () => {
    const { services, menu } = setup()
    const listener = mock<(action: PlayerAction) => void>()
    const unsubscribe = services.hostActions?.subscribe(listener)
    menu.emit('skipForward')
    menu.emit('next')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ type: 'seekBy', seconds: 10 })
    unsubscribe?.()
    menu.emit('togglePlay')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('isPlayState', () => {
  it('accepts a queue of ids', () => {
    expect(isPlayState({ queue: [A, B] })).toBe(true)
  })
  it('rejects anything that is not an id', () => {
    expect(isPlayState({ queue: ['../x'] })).toBe(false)
    expect(isPlayState(null)).toBe(false)
    expect(isPlayState({})).toBe(false)
  })
})
