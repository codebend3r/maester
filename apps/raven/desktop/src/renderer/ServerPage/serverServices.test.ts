import { describe, expect, it, mock, spyOn } from 'bun:test'
import { createMenuHub } from '@/renderer/desktop/menuHub'
import { serverApiFor } from '@/renderer/desktop/serverApi'
import { resumeAtFor, serverServicesFor } from '@/renderer/ServerPage/serverServices'
import {
  type CallKey,
  reply,
  S,
  sentOfType,
  serverClient,
  VHAGAR,
} from '@/renderer/test/serverFakes'
import { DESKTOP_REPLIES, SERVER_METHODS } from '@/shared/protocol'
import { mediaItemFor } from '@/shared/test/mediaItem'

const EPISODE = mediaItemFor({ duration: 1200 })

const PLAY_CALL: CallKey = `${SERVER_METHODS.post} /api/media/7/plays`
const SAVE_CALL: CallKey = `${SERVER_METHODS.put} /api/media/7/progress`
const SAVED = reply({ status: 204, body: '' })

type Built = Parameters<typeof serverServicesFor>[0]

const servicesWith = ({
  next = null,
  escape = { run: () => undefined, feedback: null },
  length = { current: EPISODE.duration },
  hasRecordedPlay = { current: false },
  calls = { [PLAY_CALL]: SAVED, [SAVE_CALL]: SAVED },
}: {
  next?: Built['next']
  escape?: Built['escape']
  length?: Built['length']
  hasRecordedPlay?: Built['hasRecordedPlay']
  calls?: Parameters<typeof serverClient>[0]['calls']
} = {}) => {
  const client = serverClient({ calls })
  const lastSaved = { current: 0 }
  const services = serverServicesFor({
    media: EPISODE,
    server: VHAGAR,
    api: serverApiFor({ client, serverId: S }),
    client,
    menu: createMenuHub(),
    at: 0,
    next,
    lastSaved,
    length,
    hasRecordedPlay,
    escape,
    onEngineError: mock(() => undefined),
  })
  return { client, lastSaved, services }
}

describe('resumeAtFor', () => {
  it.each([
    { at: 30, position: 50, duration: 1200, expected: 30 },
    { at: 0, position: 50, duration: 1200, expected: 50 },
    { at: 0, position: 1195, duration: 1200, expected: 0 },
    { at: 1195, position: 0, duration: 1200, expected: 0 },
    { at: 0, position: 50, duration: null, expected: 50 },
    { at: 0, position: 0, duration: 1200, expected: 0 },
  ])(
    'starts at $expected for at $at, position $position and duration $duration',
    ({ at, position, duration, expected }) => {
      expect(resumeAtFor({ at, media: mediaItemFor({ position, duration }) })).toBe(expected)
    },
  )
})

describe('serverServicesFor', () => {
  it('records a play on the server when playback starts', () => {
    const { client, services } = servicesWith()
    services.progress.started()
    expect(client.request).toHaveBeenCalledWith({
      type: 'serverCall',
      serverId: S,
      method: 'POST',
      path: '/api/media/7/plays',
      body: null,
    })
  })

  it('records the play once for the page, however often the services are built', () => {
    const hasRecordedPlay = { current: false }
    const first = servicesWith({ hasRecordedPlay })
    first.services.progress.started()
    const second = servicesWith({ hasRecordedPlay })
    second.services.progress.started()
    expect(sentOfType({ client: first.client, type: 'serverCall' })).toHaveLength(1)
    expect(sentOfType({ client: second.client, type: 'serverCall' })).toEqual([])
  })

  it('keeps the length the engine learned in the page ref, so a rebuild still has it', () => {
    const length = { current: null }
    servicesWith({ length }).services.progress.duration!(200)
    const { client, services } = servicesWith({ length })
    services.progress.left(50)
    expect(sentOfType({ client, type: 'noteServerTitle' })).toEqual([
      { type: 'noteServerTitle', serverId: S, mediaId: 7, label: 'Episode 1', watched: 0.25 },
    ])
  })

  it('saves the position and audio track on the server and remembers the position for the page', () => {
    const { client, lastSaved, services } = servicesWith()
    services.progress.save({ position: 40, audio: 1 })
    expect(client.request).toHaveBeenCalledWith({
      type: 'serverCall',
      serverId: S,
      method: 'PUT',
      path: '/api/media/7/progress',
      body: '{"position":40,"audio":1}',
    })
    expect(lastSaved.current).toBe(40)
  })

  it('keeps playing with only a warning when main refuses its reports for another account', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    const refused = {
      type: DESKTOP_REPLIES.serverUnreachable,
      message: 'raven player is signed in to Vhagar as someone else now.',
    }
    const { lastSaved, services } = servicesWith({
      calls: { [PLAY_CALL]: refused, [SAVE_CALL]: refused },
    })
    services.progress.started()
    services.progress.save({ position: 40, audio: null })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(lastSaved.current).toBe(40)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('notes the share watched in the recents when the title is left', () => {
    const { client, services } = servicesWith()
    services.progress.duration!(120)
    services.progress.left(60)
    expect(sentOfType({ client, type: 'noteServerTitle' })).toEqual([
      { type: 'noteServerTitle', serverId: S, mediaId: 7, label: 'Episode 1', watched: 0.5 },
    ])
  })

  it('links the next title by ids, with the rest of the queue behind it', () => {
    const { services } = servicesWith({ next: { mediaId: 8, label: 'Episode 2', rest: [9] } })
    expect(services.title.next).toEqual({
      to: `/server/${S}/8`,
      state: { at: 0, next: [9] },
      label: 'Episode 2',
    })
    expect(servicesWith().services.title.next).toBeNull()
  })

  it('names the title, shows no poster, and opens the title in the browser as its escape', () => {
    const opened: string[] = []
    const { services } = servicesWith({
      escape: { run: () => opened.push('browser'), feedback: 'No browser.' },
    })
    expect(services.title).toMatchObject({ label: 'Episode 1', duration: 1200, backTo: '/' })
    expect(services.posterUrl).toBeNull()
    expect(services.escapeHint).toBeNull()
    expect(services.trackPicks).toBeUndefined()
    expect(services.unplayableNote).toBe('raven player could not play this title from Vhagar.')
    expect(services.escape).toMatchObject({ label: 'Open in browser', icon: 'globe' })
    services.escape!.run()
    expect(opened).toEqual(['browser'])
    expect(services.escapeFeedback).toBe('No browser.')
  })

  it('offers no escape when the page has none', () => {
    const { services } = servicesWith({ escape: null })
    expect(services.escape).toBeNull()
    expect(services.escapeFeedback).toBeNull()
  })
})
