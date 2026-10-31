import {
  AUDIO_COMMANDS,
  AUDIO_EVENTS,
  type AudioCommand,
  type AudioEvent,
  AUDIO_BITRATES,
  DEFAULT_LEVELLING_MODE,
  EQ_PRESET_NAMES,
  EQ_PRESETS,
  FLAT_EQUALIZER,
  LEVELLING_MODES,
  LIBRARY_KINDS,
  type Library,
  PLAYER_CONNECTION_STATUSES,
  PLAYER_ERROR_REASONS,
  REMOTE_COMMANDS,
} from '@raven/core'
import {
  AUDIO_STATES,
  MUSIC_QUALITIES,
  playingTrackOf,
  useAudioQueue,
  usePlayerPrefs,
} from '@raven/ui/headless'
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, cleanup, waitFor } from '@testing-library/react'
import { DesktopAudioHost } from '@/desktop/audio/DesktopAudioHost'
import type { NativeAudio } from '@/desktop/audioConnection'
import { CONNECTION_STATUSES } from '@/desktop/portConnection'
import { api } from '@/lib/api'
import { asPlayingDesktop, audioConnectionsOf } from '@/test/desktop'
import { library, mediaItem } from '@/test/fixtures'
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

const MUSIC = library({
  id: 3,
  name: 'Music',
  settings: { ...library().settings, kind: LIBRARY_KINDS.music },
})
const BOOKS = library({
  id: 4,
  name: 'Audiobooks',
  settings: { ...library().settings, kind: LIBRARY_KINDS.audiobooks },
})
const BOOK = track({ id: 201, libraryId: BOOKS.id, title: 'The Hobbit', duration: 3000 })

const store = () => useAudioQueue.getState()

type OfTypeProps = { commands: readonly AudioCommand[]; type: AudioCommand['type'] }

const ofType = ({ commands, type }: OfTypeProps) =>
  commands.filter((command) => command.type === type)

type RenderNativeProps = { libraries?: Library[] }

const renderNative = ({ libraries = [MUSIC] }: RenderNativeProps = {}) => {
  const audio = fakeAudio()
  asPlayingDesktop({
    audio: audioConnectionsOf({ status: CONNECTION_STATUSES.native, player: audio.player }),
  })
  renderWithProviders({
    ui: <DesktopAudioHost api={api} reprobe={() => undefined} />,
    libraries,
  })
  return audio
}

afterEach(() => {
  cleanup()
  act(() => store().clear())
  mock.restore()
  usePlayerPrefs.getState().setAudiobookSpeed(1)
  usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.original)
  usePlayerPrefs.getState().setLevelling(DEFAULT_LEVELLING_MODE)
  usePlayerPrefs.getState().setEqualizer(FLAT_EQUALIZER)
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
    expect(document.querySelectorAll('audio')).toHaveLength(2)
  })

  it("plays through the page's own audio host once main's engine is lost", () => {
    asPlayingDesktop({
      audio: audioConnectionsOf({ status: CONNECTION_STATUSES.lost, message: 'Gone.' }),
    })
    renderWithProviders({ ui: <DesktopAudioHost api={api} reprobe={() => undefined} /> })
    expect(document.querySelectorAll('audio')).toHaveLength(2)
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
      {
        type: AUDIO_COMMANDS.load,
        mediaId: 1,
        level: 1,
        next: { mediaId: 2, level: 1, kbps: null },
        start: 0,
        kbps: null,
      },
    ])
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.nowPlaying })).toMatchObject([
      { info: { title: TRACKS[0].title, album: TRACKS[0].album.title, artwork: null } },
    ])
    act(() => store().playNext([track({ id: 9 })]))
    await act(async () => {})
    expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.queueNext })).toEqual([
      { type: AUDIO_COMMANDS.queueNext, next: { mediaId: 9, level: 1, kbps: null } },
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
      { type: AUDIO_COMMANDS.queueNext, next: { mediaId: 3, level: 1, kbps: null } },
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

  it("plays an audiobook at the prefs' speed and music at 1", async () => {
    usePlayerPrefs.getState().setAudiobookSpeed(1.5)
    spyOn(api, 'getMedia').mockResolvedValue(mediaItem({ id: BOOK.id, position: 0 }))
    const audio = renderNative({ libraries: [MUSIC, BOOKS] })
    const speeds = () => ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.speed })
    await waitFor(() => expect(speeds()).toEqual([{ type: AUDIO_COMMANDS.speed, rate: 1 }]))
    act(() => store().playTracks({ tracks: [BOOK] }))
    await waitFor(() => expect(speeds().at(-1)).toEqual({ type: AUDIO_COMMANDS.speed, rate: 1.5 }))
    act(() => usePlayerPrefs.getState().setAudiobookSpeed(2))
    await waitFor(() => expect(speeds().at(-1)).toEqual({ type: AUDIO_COMMANDS.speed, rate: 2 }))
    act(() => store().playTracks({ tracks: TRACKS }))
    await waitFor(() => expect(speeds().at(-1)).toEqual({ type: AUDIO_COMMANDS.speed, rate: 1 }))
  })

  it('loads an audiobook at its saved spot, and saves the spot as it plays', async () => {
    spyOn(api, 'getMedia').mockResolvedValue(
      mediaItem({ id: BOOK.id, position: 600, duration: 3000 }),
    )
    const saves: number[] = []
    spyOn(api, 'saveProgress').mockImplementation(async ({ position }) => {
      saves.push(position)
    })
    const audio = renderNative({ libraries: [MUSIC, BOOKS] })
    act(() => store().playTracks({ tracks: [BOOK] }))
    await waitFor(() =>
      expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.load })).toEqual([
        {
          type: AUDIO_COMMANDS.load,
          mediaId: BOOK.id,
          level: 1,
          next: null,
          start: 600,
          kbps: null,
        },
      ]),
    )
    audio.emit({ type: AUDIO_EVENTS.paused, paused: false })
    audio.emit({ type: AUDIO_EVENTS.time, time: 612 })
    audio.emit({ type: AUDIO_EVENTS.paused, paused: true })
    await waitFor(() => expect(saves).toEqual([612, 612]))
  })

  it('asks main for the transcode at the bitrate the prefs pick, the queued track again as it changes, and an audiobook for its file', async () => {
    usePlayerPrefs.getState().setMusicQuality(AUDIO_BITRATES.standard)
    spyOn(api, 'getMedia').mockResolvedValue(mediaItem({ id: BOOK.id, position: 0 }))
    const audio = renderNative({ libraries: [MUSIC, BOOKS] })
    const loads = () => ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.load })
    act(() => store().playTracks({ tracks: TRACKS }))
    await waitFor(() =>
      expect(loads()).toEqual([
        {
          type: AUDIO_COMMANDS.load,
          mediaId: 1,
          level: 1,
          next: { mediaId: 2, level: 1, kbps: 256 },
          start: 0,
          kbps: 256,
        },
      ]),
    )
    const queues = () => ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.queueNext })
    act(() => usePlayerPrefs.getState().setMusicQuality(AUDIO_BITRATES.high))
    await waitFor(() =>
      expect(queues().at(-1)).toEqual({
        type: AUDIO_COMMANDS.queueNext,
        next: { mediaId: 2, level: 1, kbps: 320 },
      }),
    )
    act(() => store().playTracks({ tracks: [BOOK] }))
    await waitFor(() =>
      expect(loads().at(-1)).toEqual({
        type: AUDIO_COMMANDS.load,
        mediaId: BOOK.id,
        level: 1,
        next: null,
        start: 0,
        kbps: null,
      }),
    )
  })

  it("tells main each track's level and the equalizer's gains as they change", async () => {
    const quiet = track({
      id: 1,
      gain: { track: -6.0206, album: null, trackPeak: null, albumPeak: null },
    })
    const loud = track({ id: 2, gain: { track: 0, album: null, trackPeak: null, albumPeak: null } })
    const audio = renderNative()
    const sounds = () => ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.sound })
    await waitFor(() =>
      expect(sounds()).toEqual([
        { type: AUDIO_COMMANDS.sound, level: 1, nextLevel: null, eq: FLAT_EQUALIZER.gains },
      ]),
    )
    act(() => store().playTracks({ tracks: [quiet, loud] }))
    await waitFor(() =>
      expect(ofType({ commands: audio.sent(), type: AUDIO_COMMANDS.load })).toMatchObject([
        { mediaId: 1, level: expect.closeTo(0.5, 4), next: { mediaId: 2, level: 1 } },
      ]),
    )
    await waitFor(() =>
      expect(sounds().at(-1)).toMatchObject({ level: expect.closeTo(0.5, 4), nextLevel: 1 }),
    )
    act(() =>
      usePlayerPrefs
        .getState()
        .setEqualizer({ preset: EQ_PRESET_NAMES.vocal, gains: EQ_PRESETS.vocal }),
    )
    await waitFor(() => expect(sounds().at(-1)).toMatchObject({ eq: EQ_PRESETS.vocal }))
    audio.emit({ type: AUDIO_EVENTS.advanced })
    await waitFor(() =>
      expect(sounds().at(-1)).toEqual({
        type: AUDIO_COMMANDS.sound,
        level: 1,
        nextLevel: null,
        eq: EQ_PRESETS.vocal,
      }),
    )
    act(() => usePlayerPrefs.getState().setLevelling(LEVELLING_MODES.off))
    act(() => store().previous())
    await waitFor(() => expect(playingTrackOf(store())?.id).toBe(1))
    expect(sounds().at(-1)).toMatchObject({ level: 1 })
  })

  it('fails the track when main refuses to load it', async () => {
    const audio = fakeAudio()
    audio.player.send = async () => {
      throw new Error('Sign in to Vhagar to play this.')
    }
    asPlayingDesktop({
      audio: audioConnectionsOf({ status: CONNECTION_STATUSES.native, player: audio.player }),
    })
    renderWithProviders({
      ui: <DesktopAudioHost api={api} reprobe={() => undefined} />,
      libraries: [MUSIC],
    })
    act(() => store().playTracks({ tracks: TRACKS }))
    await act(async () => {})
    expect(store()).toMatchObject({
      state: AUDIO_STATES.failed,
      error: 'Sign in to Vhagar to play this.',
    })
  })
})
