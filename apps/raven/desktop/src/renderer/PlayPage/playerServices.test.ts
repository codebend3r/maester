import { describe, expect, it, mock, spyOn } from 'bun:test'
import type { PlayerAction } from '@raven/core'
import { createMenuHub } from '@/renderer/desktop/menuHub'
import {
  ENGINE_NOTES,
  type EngineUse,
  isPlayState,
  playerActionFor,
  servicesFor,
} from '@/renderer/PlayPage/playerServices'
import { fakeClient } from '@/renderer/test/render'
import type { LocalFile, MenuPlayerAction } from '@/shared/protocol'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const FILE: LocalFile = {
  fileId: A,
  label: 'Clip 01',
  folder: 'Clips',
  isDownload: false,
  resumeAt: 42,
  next: null,
  tracks: null,
}

const setup = ({
  file = FILE,
  engine = 'native',
}: { file?: LocalFile; engine?: EngineUse } = {}) => {
  const client = fakeClient()
  const menu = createMenuHub()
  return { client, menu, services: servicesFor({ file, client, menu, engine }) }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('playerActionFor', () => {
  const table: Array<[MenuPlayerAction, PlayerAction | null]> = [
    ['togglePlay', { type: 'togglePlay' }],
    ['skipBack', { type: 'skip', direction: -1 }],
    ['skipForward', { type: 'skip', direction: 1 }],
    ['showShortcuts', { type: 'showShortcuts' }],
    ['next', null],
    ['stats', { type: 'toggleStats' }],
  ]
  it.each(table)('maps %s', (action, expected) => {
    expect(playerActionFor(action)).toEqual(expected)
  })
})

describe('servicesFor', () => {
  it('describes the title with no next video', () => {
    expect(setup().services.title).toEqual({
      label: 'Clip 01',
      context: null,
      duration: null,
      resumeAt: 42,
      backTo: '/',
      next: null,
    })
  })

  it('names where a download came from, and no folder for any other file', () => {
    const download = setup({
      file: { ...FILE, folder: 'Downloaded from Vhagar', isDownload: true },
    })
    expect(download.services.title.context).toBe('Downloaded from Vhagar')
    expect(setup().services.title.context).toBeNull()
  })

  it('links the next video with its queue', () => {
    const { services } = setup({
      file: { ...FILE, next: { fileId: B, label: 'Clip 02', queue: [C] } },
    })
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
    services.progress.started()
    services.progress.duration!(30)
    services.progress.save({ position: 12, audio: null })
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

  it('sends no position for a file left before playback started', () => {
    const { services, client } = setup()
    services.progress.left(42)
    expect(client.request).not.toHaveBeenCalled()
    services.progress.started()
    services.progress.left(43)
    expect(client.request).toHaveBeenCalledWith({
      type: 'savePosition',
      fileId: A,
      position: 43,
      duration: null,
    })
  })

  it('saves a null length before the engine reports one', () => {
    const { services, client } = setup()
    services.progress.save({ position: 12, audio: null })
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
    const unsubscribe = services.hostActions!.subscribe(listener)
    menu.emit('skipForward')
    menu.emit('next')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ type: 'skip', direction: 1 })
    unsubscribe()
    menu.emit('togglePlay')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('servicesFor, the desktop seams', () => {
  it('starts from the stored track pick', () => {
    const { services } = setup({ file: { ...FILE, tracks: { audio: 1, subtitle: null } } })
    expect(services.trackPicks!.start).toEqual({ audio: 1, subtitle: null })
  })

  it('starts from no pick when none is stored', () => {
    expect(setup().services.trackPicks!.start).toBeNull()
  })

  it('saves a pick by hand for this file', () => {
    const { services, client } = setup()
    services.trackPicks!.save({ audio: 0, subtitle: 'embedded-0' })
    expect(client.request).toHaveBeenCalledWith({
      type: 'saveTracks',
      fileId: A,
      audio: 0,
      subtitle: 'embedded-0',
    })
  })

  it('shows and hides the window buttons with the controls', () => {
    const { services, client } = setup()
    services.chrome!.shown(false)
    services.chrome!.shown(true)
    expect(client.request).toHaveBeenNthCalledWith(1, { type: 'windowButtons', isVisible: false })
    expect(client.request).toHaveBeenNthCalledWith(2, { type: 'windowButtons', isVisible: true })
  })

  it('handles a request that rejects', async () => {
    const client = fakeClient({ request: () => Promise.reject(new Error('gone')) })
    const services = servicesFor({
      file: FILE,
      client,
      menu: createMenuHub(),
      engine: 'native',
    })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    services.chrome!.shown(false)
    services.trackPicks!.save({ audio: 0, subtitle: null })
    services.progress.save({ position: 3, audio: null })
    await settled()
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it('says why a video cannot play per engine', () => {
    expect(setup({ engine: 'native' }).services.unplayableNote).toBe(ENGINE_NOTES.native)
    expect(setup({ engine: 'fallback' }).services.unplayableNote).toBe(ENGINE_NOTES.fallback)
    expect(setup({ engine: 'stopped' }).services.unplayableNote).toBe(ENGINE_NOTES.stopped)
    expect(ENGINE_NOTES).toEqual({
      native: 'raven player could not play this video.',
      fallback: "raven player's video engine did not start, and this video needs it.",
      stopped: "raven player's video engine stopped, and this video needs it.",
    })
  })

  it('forwards Video Info from the menu as the stats action', () => {
    const { services, menu } = setup()
    const listener = mock<(action: PlayerAction) => void>()
    services.hostActions!.subscribe(listener)
    menu.emit('stats')
    expect(listener).toHaveBeenCalledWith({ type: 'toggleStats' })
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
