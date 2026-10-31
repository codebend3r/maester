import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { AUDIO_BITRATES, LIBRARY_KINDS } from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { useAudiobookChapters, useTrackBitrate } from '@/query/useAudiobook'
import { MUSIC_QUALITIES, usePlayerPrefs } from '@/stores/playerPrefs'
import { library, track } from '@/test/fixtures'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const BOOKS = library({
  id: 3,
  settings: { ...library().settings, kind: LIBRARY_KINDS.audiobooks },
})
const MUSIC = library({ id: 4, settings: { ...library().settings, kind: LIBRARY_KINDS.music } })
const CHAPTERS = [
  { start: 0, end: 30, title: 'Opening' },
  { start: 30, end: 900, title: 'One' },
]

const { api } = recordingApi({ body: null })

const holdingLibraries = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.libraries, [BOOKS, MUSIC])
  return client
}

describe('useAudiobookChapters', () => {
  const markers = spyOn(api, 'getMarkers')

  afterEach(() => markers.mockReset())

  it("reads an audiobook's chapters, never its intro, from the file's markers", async () => {
    markers.mockResolvedValue({
      intro: { kind: 'intro', start: 0, end: 30, source: 'chapter', confidence: 1 },
      credits: null,
      chapters: CHAPTERS,
    })
    const { result } = renderQueryHook({
      client: holdingLibraries(),
      hook: () => useAudiobookChapters({ api, track: track({ id: 8, libraryId: 3 }) }),
    })
    await waitFor(() => expect(result.current.chapters).toEqual(CHAPTERS))
    expect(result.current.isAudiobook).toBe(true)
    expect(markers).toHaveBeenCalledWith(8)
  })

  it('asks for nothing for a song, or for no track at all', () => {
    const client = holdingLibraries()
    const song = renderQueryHook({
      client,
      hook: () => useAudiobookChapters({ api, track: track({ libraryId: 4 }) }),
    })
    const none = renderQueryHook({ client, hook: () => useAudiobookChapters({ api, track: null }) })
    expect(song.result.current).toEqual({ isAudiobook: false, chapters: [] })
    expect(none.result.current).toEqual({ isAudiobook: false, chapters: [] })
    expect(markers).not.toHaveBeenCalled()
  })
})

describe('useTrackBitrate', () => {
  afterEach(() => usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.original))

  it("is the prefs' bitrate for a song, and null for a book, the original, or no track", () => {
    const client = holdingLibraries()
    const bitrateOf = (libraryId: number | null) =>
      renderQueryHook({
        client,
        hook: () =>
          useTrackBitrate({ api, track: libraryId === null ? null : track({ libraryId }) }),
      }).result.current
    expect(bitrateOf(4)).toBeNull()
    usePlayerPrefs.getState().setMusicQuality(AUDIO_BITRATES.high)
    expect(bitrateOf(4)).toBe(AUDIO_BITRATES.high)
    expect(bitrateOf(3)).toBeNull()
    expect(bitrateOf(null)).toBeNull()
  })

  it('asks for the file while the libraries are unknown, so a book is never a transcode', async () => {
    usePlayerPrefs.getState().setMusicQuality(AUDIO_BITRATES.standard)
    const libraries = spyOn(api, 'listLibraries').mockRejectedValue(new Error('offline'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderQueryHook({
      client,
      hook: () => useTrackBitrate({ api, track: track({ libraryId: 4 }) }),
    })
    expect(result.current).toBeNull()
    await waitFor(() => expect(libraries).toHaveBeenCalled())
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.libraries)?.error).toBeInstanceOf(Error),
    )
    expect(result.current).toBeNull()
    libraries.mockRestore()
  })
})
