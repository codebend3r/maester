import {
  QUEUE_SOURCE_KINDS,
  type QueueSource,
  RADIO_SEED_KINDS,
  REPEAT_MODES,
  type Track,
} from '@raven/core'
import { beforeEach, describe, expect, it } from 'bun:test'
import { AUDIO_STATES, nextTrackOf, playingTrackOf, useAudioQueue } from '@/stores/audioQueue'

type TrackProps = { id: number; title?: string }

const track = ({ id, title = `Track ${id}` }: TrackProps): Track => ({
  id,
  libraryId: 1,
  albumId: 7,
  title,
  disc: 1,
  number: id,
  duration: 200,
  artists: [{ id: 1, name: 'Radiohead' }],
  container: 'flac',
  codec: 'flac',
  bitrate: 900000,
  sampleRate: 44100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: 'OK Computer', coverVersion: 'v1' },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
})

const ALBUM: Track[] = [track({ id: 1 }), track({ id: 2 }), track({ id: 3 })]

const store = () => useAudioQueue.getState()

describe('useAudioQueue', () => {
  beforeEach(() => store().clear())

  it('plays an album from a track, loading it, and names the track and the one after', () => {
    store().playTracks({ tracks: ALBUM, startAt: 1, source: { kind: 'album', id: 7 } })
    expect(store()).toMatchObject({ state: AUDIO_STATES.loading, shouldPlay: true })
    expect(playingTrackOf(store())?.title).toBe('Track 2')
    expect(nextTrackOf(store())?.title).toBe('Track 3')
    expect(store().queue.source).toEqual({ kind: 'album', id: 7 })
  })

  it('follows the engine: playing, time, the end of a track, and the end of the queue', () => {
    store().playTracks({ tracks: ALBUM })
    store().engine.state(AUDIO_STATES.playing)
    store().engine.time({ position: 12, duration: 200 })
    expect(store()).toMatchObject({ state: AUDIO_STATES.playing, position: 12, duration: 200 })
    store().engine.ended()
    expect(playingTrackOf(store())?.id).toBe(2)
    expect(store()).toMatchObject({ state: AUDIO_STATES.loading, position: 0, duration: null })
    store().engine.ended()
    store().engine.ended()
    expect(store()).toMatchObject({ state: AUDIO_STATES.empty, shouldPlay: false })
    expect(playingTrackOf(store())).toBeNull()
  })

  it('pauses and plays again, and ignores play on nothing', () => {
    store().play()
    expect(store().state).toBe(AUDIO_STATES.empty)
    store().playTracks({ tracks: ALBUM })
    store().engine.state(AUDIO_STATES.playing)
    store().toggle()
    expect(store().state).toBe(AUDIO_STATES.paused)
    store().play()
    expect(store().state).toBe(AUDIO_STATES.playing)
    store().pause()
    expect(store().state).toBe(AUDIO_STATES.paused)
  })

  it('can pause and resume while loading without engine reports changing the intent', () => {
    store().playTracks({ tracks: ALBUM })
    store().toggle()
    expect(store()).toMatchObject({ state: AUDIO_STATES.paused, shouldPlay: false })
    store().play()
    expect(store()).toMatchObject({ state: AUDIO_STATES.playing, shouldPlay: true })
    store().engine.state(AUDIO_STATES.paused)
    expect(store().shouldPlay).toBe(true)
    store().pause()
    expect(store().shouldPlay).toBe(false)
    store().engine.state(AUDIO_STATES.playing)
    store().toggle()
    expect(store().shouldPlay).toBe(true)
    store().clear()
    expect(store().shouldPlay).toBe(false)
    store().playTracks({ tracks: [] })
    expect(store().shouldPlay).toBe(false)
  })

  it('restarts the track from Previous past three seconds, else steps back', () => {
    store().playTracks({ tracks: ALBUM, startAt: 1 })
    store().engine.time({ position: 10, duration: 200 })
    store().previous()
    expect(playingTrackOf(store())?.id).toBe(2)
    expect(store().seek).toEqual({ seconds: 0, nonce: 1 })
    store().engine.sought()
    store().engine.time({ position: 1, duration: 200 })
    store().previous()
    expect(playingTrackOf(store())?.id).toBe(1)
  })

  it('queues tracks next and at the end, starting an empty queue on them', () => {
    store().addToQueue([track({ id: 9 })])
    expect(playingTrackOf(store())?.id).toBe(9)
    expect(store().state).toBe(AUDIO_STATES.loading)
    store().playNext([track({ id: 5 })])
    store().addToQueue([track({ id: 6 })])
    expect(nextTrackOf(store())?.id).toBe(5)
    store().engine.ended()
    store().engine.ended()
    expect(playingTrackOf(store())?.id).toBe(6)
  })

  it('seeks only while something plays, and the engine clears the request', () => {
    store().seekTo(30)
    expect(store().seek).toBeNull()
    store().playTracks({ tracks: ALBUM })
    store().seekTo(30)
    expect(store()).toMatchObject({ seek: { seconds: 30, nonce: 1 }, position: 30 })
    store().engine.sought()
    expect(store().seek).toBeNull()
  })

  it('jumps, removes, moves, shuffles and repeats through the queue model', () => {
    store().playTracks({ tracks: ALBUM })
    store().jump(2)
    expect(playingTrackOf(store())?.id).toBe(3)
    store().move({ from: 2, to: 0 })
    expect(playingTrackOf(store())?.id).toBe(3)
    store().remove(0)
    expect(playingTrackOf(store())?.id).toBe(1)
    store().toggleShuffle()
    expect(store().queue.isShuffled).toBe(true)
    store().toggleShuffle()
    expect(store().queue.isShuffled).toBe(false)
    store().cycleRepeat()
    expect(store().queue.repeat).toBe(REPEAT_MODES.all)
    store().clear()
    expect(store().queue.repeat).toBe(REPEAT_MODES.all)
    expect(store().state).toBe(AUDIO_STATES.empty)
  })

  it('records a failure with its reason', () => {
    store().playTracks({ tracks: ALBUM })
    store().engine.failed('The browser could not decode this file.')
    expect(store()).toMatchObject({
      state: AUDIO_STATES.failed,
      shouldPlay: false,
      error: 'The browser could not decode this file.',
    })
  })

  it('starts shuffled from the first of a random order', () => {
    store().playTracks({ tracks: ALBUM, isShuffled: true })
    expect(store().queue.isShuffled).toBe(true)
    expect(store().queue.at).toBe(0)
    expect(store().state).toBe(AUDIO_STATES.loading)
  })

  it('starts the same track over when it ends under repeat one, since the queue does not move', () => {
    store().playTracks({ tracks: ALBUM })
    // The repeat mode outlives a clear, so it is cycled from wherever the last test left it.
    Object.values(REPEAT_MODES).forEach(() => {
      if (store().queue.repeat !== REPEAT_MODES.one) store().cycleRepeat()
    })
    expect(store().queue.repeat).toBe(REPEAT_MODES.one)
    store().engine.state(AUDIO_STATES.playing)
    store().engine.time({ position: 199, duration: 200 })
    store().engine.ended()
    expect(playingTrackOf(store())?.id).toBe(1)
    expect(store()).toMatchObject({ state: AUDIO_STATES.loading, position: 0 })
    expect(store().seek?.seconds).toBe(0)
  })

  it('shuffles and repeats a radio queue as it does an album', () => {
    type StepsOfProps = { source: QueueSource }
    // What a listener sees: the shuffle keeps the playing track, repeat all wraps, repeat one stays.
    const stepsOf = ({ source }: StepsOfProps) => {
      store().clear()
      store().playTracks({ tracks: ALBUM, startAt: 1, source })
      store().toggleShuffle()
      const shuffled = {
        playing: playingTrackOf(store())?.id ?? null,
        isShuffled: store().queue.isShuffled,
        held: store().queue.order.toSorted(),
      }
      store().toggleShuffle()
      Object.values(REPEAT_MODES).forEach(() => {
        if (store().queue.repeat !== REPEAT_MODES.all) store().cycleRepeat()
      })
      store().jump(2)
      store().engine.ended()
      const wrapped = playingTrackOf(store())?.id ?? null
      store().cycleRepeat()
      const repeat = store().queue.repeat
      store().engine.ended()
      return { shuffled, wrapped, repeat, again: playingTrackOf(store())?.id ?? null }
    }
    const album = stepsOf({ source: { kind: QUEUE_SOURCE_KINDS.album, id: 7 } })
    const radio = stepsOf({
      source: { kind: QUEUE_SOURCE_KINDS.radio, id: 2, seed: RADIO_SEED_KINDS.track },
    })
    expect(radio).toEqual(album)
    expect(radio).toEqual({
      shuffled: { playing: 2, isShuffled: true, held: [0, 1, 2] },
      wrapped: 1,
      repeat: REPEAT_MODES.one,
      again: 1,
    })
    expect(store().queue.source).toEqual({
      kind: QUEUE_SOURCE_KINDS.radio,
      id: 2,
      seed: RADIO_SEED_KINDS.track,
    })
  })
})
