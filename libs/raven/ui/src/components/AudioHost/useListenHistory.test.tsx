import { type ApiClient, type Track, createApiClient } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { LISTEN_REPORT_STEP_S, useListenHistory } from '@/components/AudioHost/useListenHistory'
import { AUDIO_STATES, type AudioState, useAudioQueue } from '@/stores/audioQueue'

const track = (id: number): Track => ({
  id,
  libraryId: 1,
  albumId: 7,
  title: `Track ${id}`,
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

type Heard = {
  started: { mediaId: number; position: number }[]
  reported: { id: number; position: number }[]
}

/** An API that numbers each listen it starts and writes down every report. */
const apiHearing = (heard: Heard): ApiClient => {
  const api = createApiClient({ fetch: () => new Promise(() => undefined) })
  spyOn(api, 'startListen').mockImplementation(async (started) => {
    heard.started.push(started)
    return heard.started.length
  })
  spyOn(api, 'reportListen').mockImplementation(async (report) => {
    heard.reported.push(report)
  })
  return api
}

type PlayingProps = { state?: AudioState; position?: number }

const playing = ({ state = AUDIO_STATES.playing, position = 0 }: PlayingProps) =>
  act(() => {
    useAudioQueue.setState({ state, position, duration: 200 })
  })

describe('the history of what plays', () => {
  const heard: Heard = { started: [], reported: [] }

  beforeEach(() => {
    heard.started = []
    heard.reported = []
    playing({ state: AUDIO_STATES.loading })
  })

  afterEach(() => cleanup())

  it('starts a listen as a track starts playing, and reports how far it got as it plays on', async () => {
    const api = apiHearing(heard)
    renderHook(() => useListenHistory({ api, track: track(1) }))
    expect(heard.started).toEqual([])

    playing({ position: 0 })
    playing({ position: 1 })
    playing({ position: 1 + LISTEN_REPORT_STEP_S })

    expect(heard.started).toEqual([{ mediaId: 1, position: 0 }])
    await waitFor(() =>
      expect(heard.reported).toEqual([{ id: 1, position: 1 + LISTEN_REPORT_STEP_S }]),
    )
  })

  it('reports a short listen when it pauses, and when the next track takes over', async () => {
    const api = apiHearing(heard)
    const { rerender } = renderHook(({ id }) => useListenHistory({ api, track: track(id) }), {
      initialProps: { id: 1 },
    })
    playing({ position: 0 })
    playing({ position: 2 })
    playing({ state: AUDIO_STATES.paused, position: 2 })
    await waitFor(() => expect(heard.reported).toEqual([{ id: 1, position: 2 }]))

    playing({ position: 3 })
    // The queue moves on as the store does: loading the next track from its top.
    playing({ state: AUDIO_STATES.loading, position: 0 })
    rerender({ id: 2 })
    playing({ position: 0 })

    expect(heard.started).toEqual([
      { mediaId: 1, position: 0 },
      { mediaId: 2, position: 0 },
    ])
    await waitFor(() =>
      expect(heard.reported).toEqual([
        { id: 1, position: 2 },
        { id: 1, position: 3 },
      ]),
    )
  })

  it('starts a new listen when a finished track plays again from its top', () => {
    const api = apiHearing(heard)
    renderHook(() => useListenHistory({ api, track: track(1) }))
    playing({ position: 0 })
    playing({ position: 195 })
    playing({ position: 0 })

    expect(heard.started.map(({ mediaId }) => mediaId)).toEqual([1, 1])
  })

  it('keeps one listen through a seek back that is not a replay', () => {
    const api = apiHearing(heard)
    renderHook(() => useListenHistory({ api, track: track(1) }))
    playing({ position: 0 })
    playing({ position: 60 })
    playing({ position: 0 })

    expect(heard.started).toHaveLength(1)
  })
})
