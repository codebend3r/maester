import { describe, expect, it, mock } from 'bun:test'
import type { TicketedOrigin } from '@raven/core'
import { QueryClient } from '@tanstack/react-query'
import { api } from '@/test/api'
import { playerQueriesFor } from '@/lib/playerQueries'
import { playerQueryKeys as queryKeys } from '@/lib/playerQueryKeys'
import { DEFAULT_PLAYBACK_STATE } from '@/test/render'

describe('playerQueriesFor', () => {
  it('uses the supplied client while sharing the browser cache and invalidation keys', async () => {
    const tracks = { audio: [], subtitles: [], defaultAudio: null, frameRate: null }
    const client = {
      ...api,
      getTracks: mock(async () => tracks),
      getStreams: mock(async () => ({ video: null, audio: [] })),
      getSubtitles: mock(async () => []),
      getPlaybackSettings: mock(async () => DEFAULT_PLAYBACK_STATE),
    }
    const queries = playerQueriesFor(client)
    const cache = new QueryClient()
    const input = { id: 7, trackId: 'embedded-0', window: 0 }
    expect(queryKeys.mediaTracks(7)).toEqual(queries.tracks(7).queryKey)
    expect(queryKeys.mediaStreams(7)).toEqual(queries.streams(7).queryKey)
    expect(queryKeys.subtitles(input)).toEqual(queries.subtitles(input).queryKey)
    expect(queryKeys.playbackSettings).toEqual(queries.playbackSettings.queryKey)
    await cache.fetchQuery(queries.tracks(7))
    await cache.fetchQuery(queries.streams(7))
    await cache.fetchQuery(queries.subtitles(input))
    await cache.fetchQuery(queries.playbackSettings)
    expect(client.getTracks).toHaveBeenCalledWith(7)
    expect(client.getStreams).toHaveBeenCalledWith(7)
    // A browser's cookie carries the access, so no ticket goes with the request.
    expect(client.getSubtitles).toHaveBeenCalledWith({ ...input, access: null })
    expect(client.getPlaybackSettings).toHaveBeenCalledTimes(1)
    expect(cache.getQueryData<typeof tracks>(queryKeys.mediaTracks(7))).toEqual(tracks)
    await cache.invalidateQueries({ queryKey: queryKeys.mediaTracks(7) })
    expect(cache.getQueryState(queryKeys.mediaTracks(7))?.isInvalidated).toBe(true)
    cache.clear()
  })

  it('reads the ticket for each subtitle window where the client hands one', async () => {
    const access = {
      origin: { url: 'https://raven.home.example' },
      ticket: 'abc.def',
    } as const satisfies TicketedOrigin
    const client = { ...api, getSubtitles: mock(async () => []) }
    const queries = playerQueriesFor(client)
    const cache = new QueryClient()
    const input = { id: 7, trackId: 'embedded-0', window: 0 }
    await cache.fetchQuery(queries.subtitles({ ...input, readAccess: async () => access }))
    expect(client.getSubtitles).toHaveBeenCalledWith({ ...input, access })
    cache.clear()
  })
})
