import { describe, expect, it } from 'bun:test'
import { playerQueriesFor, playerQueryKeys, useUnlockPrompt } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { ApiError } from '@raven/core'
import { createQueryClient, queryKeys } from '@/lib/queryClient'

const failWith = (status: number) => async (): Promise<never> => {
  throw new ApiError({ status, message: 'No' })
}

describe('createQueryClient', () => {
  it('asks for the PIN when a call is refused for a locked library', async () => {
    const client = createQueryClient()
    await client
      .fetchQuery({ queryKey: ['other'], queryFn: failWith(404), retry: false })
      .catch(() => null)
    expect(useUnlockPrompt.getState().open).toBe(false)
    await client
      .fetchQuery({ queryKey: ['locked'], queryFn: failWith(423), retry: false })
      .catch(() => null)
    expect(useUnlockPrompt.getState().open).toBe(true)
  })
})

describe('shared player query keys', () => {
  it('keeps player caches reachable by the web invalidation keys', async () => {
    const client = createQueryClient()
    const queries = playerQueriesFor(api)
    const input = { id: 7, trackId: 'embedded-0', window: 0 }
    expect(queryKeys.mediaTracks).toBe(playerQueryKeys.mediaTracks)
    expect(queryKeys.subtitles).toBe(playerQueryKeys.subtitles)
    expect(queryKeys.playbackSettings).toBe(playerQueryKeys.playbackSettings)
    expect(queryKeys.mediaTracks(7)).toEqual(queries.tracks(7).queryKey)
    expect(queryKeys.subtitles(input)).toEqual(queries.subtitles(input).queryKey)
    expect(queryKeys.playbackSettings).toEqual(queries.playbackSettings.queryKey)
    client.setQueryData(queries.tracks(7).queryKey, {
      audio: [],
      subtitles: [],
      defaultAudio: null,
      frameRate: null,
    })
    client.setQueryData(queries.subtitles(input).queryKey, [])
    await client.invalidateQueries({ queryKey: queryKeys.mediaItem(7) })
    expect(client.getQueryState(queries.tracks(7).queryKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(queries.subtitles(input).queryKey)?.isInvalidated).toBe(true)
    client.clear()
  })
})
