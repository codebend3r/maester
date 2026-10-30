import {
  AUDIO_COMMANDS,
  AUDIO_EVENTS,
  type AudioCommand,
  type AudioEvent,
  PLAYER_CONNECTION_STATUSES,
  PLAYER_ERROR_REASONS,
  REMOTE_COMMANDS,
} from '@raven/core'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup } from '@testing-library/react'
import { DesktopAudioHost } from '@/desktop/audio/DesktopAudioHost'
import type { NativeAudio } from '@/desktop/audioConnection'
import { CONNECTION_STATUSES } from '@/desktop/portConnection'
import { api } from '@/lib/api'
import { asPlayingDesktop, audioConnectionsOf } from '@/test/desktop'
import { track } from '@/test/music'
import { renderWithProviders } from '@/test/render'

/** A music engine whose commands are recorded and answered at once; `emit` plays main's events. */
const fakeAudio = () => {
  const listeners = new Set<(event: AudioEvent) => void>()
  const send = mock<NativeAudio['send']>(async () => {})
  const player: NativeAudio = {
    send,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    player,
    sent: () => send.mock.calls.map(([command]) => command),
    emit: (event: AudioEvent) =>
      act(() => {
        listeners.forEach((listener) => listener(event))
      }),
  }
}

const TRACKS = [track({ id: 1 }), track({ id: 2 }), track({ id: 3 })]

const store = () => useAudioQueue.getState()

type OfTypeProps = { commands: readonly AudioCommand[]; type: AudioCommand['type'] }

const ofType = ({ commands, type }: OfTypeProps) =>
  commands.filter((command) => command.type === type)

const renderNative = () => {
  const audio = fakeAudio()
  asPlayingDesktop({
    audio: audioConnectionsOf({ status: CONNECTION_STATUSES.native, player: audio.player }),
  })
  renderWithProviders({ ui: <DesktopAudioHost api={api} reprobe={() => undefined} /> })
  return audio
}

afterEach(() => {
  cleanup()
  act(() => store().clear())
  mock.restore()
})

describe('DesktopAudioHost', () => {
  it("plays through the page's own audio host while main has no music engine", () => {
    asPlayingDesktop({
      audio: audioConnectionsOf({
        status: PLAYER_CONNECTION_STATUSES.unavailable,
        message: 'No mpv.',
      }),
    })
    renderWithProviders({ ui: <DesktopAudioHost api={api} reprobe={() => undefined} /> })
    expect(document.querySelectorAll('audio')).toHaveLength(1)
  })

  it("plays through the page's own audio host once main's engine is lost", () => {
    asPlayingDesktop({
      audio: audioConnectionsOf({ status: CONNECTION_STATUSES.lost, message: 'Gone.' }),
    })
    renderWithProviders({ ui: <DesktopAudioHost api={api} reprobe={() => undefined} /> })
    expect(document.querySelectorAll('audio')).toHaveLength(1)
  })

  it("renders nothing while main's answer is on its way", () => {
    asPlayingDesktop({ audio: audioConnectionsOf({ status: CONNECTION_STATUSES.waiting }) })
    renderWithProviders({ ui: <DesktopAudioHost api={api} reprobe={() => undefined} /> })
    expect(document.querySelectorAll('audio')).toHaveLength(0)
  })

  it('tells main the playing track and the one after it, then only what changes', async () => {
    const audio = renderNative()
    act(() => store().playTracks({ tracks: TRACKS }))
    await act(async () => {})
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.load })).toEqual([
      { type: AUDIO_COMMANDS.load, mediaId: 1, next: 2, start: 0 },
    ])
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.nowPlaying })).toMatchObject([
      { info: { title: TRACKS[0].title, album: TRACKS[0].album.title, artwork: null } },
    ])
    act(() => store().playNext([track({ id: 9 })]))
    await act(async () => {})
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.queueNext })).toEqual([
      { type: AUDIO_COMMANDS.queueNext, next: 9 },
    ])
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.load })).toHaveLength(1)
  })

  it('follows what mpv reports into the store', () => {
    const audio = renderNative()
    act(() => store().playTracks({ tracks: TRACKS }))
    audio.emit({ type: AUDIO_EVENTS.duration, duration: 200 })
    audio.emit({ type: AUDIO_EVENTS.time, time: 12 })
    audio.emit({ type: AUDIO_EVENTS.paused, paused: false })
    expect(store()).toMatchObject({ state: AUDIO_STATES.playing, position: 12, duration: 200 })
    audio.emit({ type: AUDIO_EVENTS.paused, paused: true })
    expect(store().state).toBe(AUDIO_STATES.paused)
    audio.emit({ type: AUDIO_EVENTS.waiting, waiting: true })
    expect(store().state).toBe(AUDIO_STATES.loading)
    audio.emit({ type: AUDIO_EVENTS.error, reason: PLAYER_ERROR_REASONS.decode, message: 'Bad' })
    expect(store()).toMatchObject({ state: AUDIO_STATES.failed, error: 'Bad' })
  })

  it('steps the queue when mpv moves on by itself, and names only the new next', async () => {
    const audio = renderNative()
    act(() => store().playTracks({ tracks: TRACKS }))
    await act(async () => {})
    audio.emit({ type: AUDIO_EVENTS.advanced })
    await act(async () => {})
    expect(store().queue.at).toBe(1)
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.load })).toHaveLength(1)
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.queueNext })).toEqual([
      { type: AUDIO_COMMANDS.queueNext, next: 3 },
    ])
  })

  it('loads afresh when a track ends with nothing queued, and stops when the queue runs out', async () => {
    const audio = renderNative()
    act(() => store().playTracks({ tracks: [TRACKS[0]] }))
    act(() => store().cycleRepeat())
    act(() => store().cycleRepeat())
    await act(async () => {})
    // Repeat one: the same track again, loaded afresh.
    audio.emit({ type: AUDIO_EVENTS.ended })
    await act(async () => {})
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.load })).toHaveLength(2)
    act(() => store().cycleRepeat())
    audio.emit({ type: AUDIO_EVENTS.ended })
    await act(async () => {})
    expect(store().state).toBe(AUDIO_STATES.empty)
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.stop })).toHaveLength(1)
  })

  it('pauses, plays and seeks on the store’s word', async () => {
    const audio = renderNative()
    act(() => store().playTracks({ tracks: TRACKS }))
    audio.emit({ type: AUDIO_EVENTS.paused, paused: false })
    act(() => store().pause())
    await act(async () => {})
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.pause })).toHaveLength(1)
    act(() => store().play())
    act(() => store().seekTo(42))
    await act(async () => {})
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.seek })).toEqual([
      { type: AUDIO_COMMANDS.seek, time: 42 },
    ])
    expect(store().seek).toBeNull()
  })

  it('drives the store from the system’s transport controls', () => {
    const audio = renderNative()
    act(() => store().playTracks({ tracks: TRACKS }))
    audio.emit({ type: AUDIO_EVENTS.paused, paused: false })
    audio.emit({ type: AUDIO_EVENTS.remote, command: { kind: REMOTE_COMMANDS.toggle } })
    expect(store().state).toBe(AUDIO_STATES.paused)
    audio.emit({ type: AUDIO_EVENTS.remote, command: { kind: REMOTE_COMMANDS.next } })
    expect(store().queue.at).toBe(1)
    audio.emit({ type: AUDIO_EVENTS.remote, command: { kind: REMOTE_COMMANDS.seek, time: 9 } })
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.seek })).toEqual([
      { type: AUDIO_COMMANDS.seek, time: 9 },
    ])
    audio.emit({ type: AUDIO_EVENTS.remote, command: { kind: REMOTE_COMMANDS.stop } })
    expect(store().state).toBe(AUDIO_STATES.empty)
  })

  it('fails the track when main refuses to load it', async () => {
    const audio = fakeAudio()
    audio.player.send = async () => {
      throw new Error('Sign in to Vhagar to play this.')
    }
    asPlayingDesktop({
      audio: audioConnectionsOf({ status: CONNECTION_STATUSES.native, player: audio.player }),
    })
    renderWithProviders({ ui: <DesktopAudioHost api={api} reprobe={() => undefined} /> })
    act(() => store().playTracks({ tracks: TRACKS }))
    await act(async () => {})
    expect(store()).toMatchObject({
      state: AUDIO_STATES.failed,
      error: 'Sign in to Vhagar to play this.',
    })
  })
})
