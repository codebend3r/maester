import { describe, expect, it } from 'bun:test'
import { ApiError } from '@raven/core'
import { createQueryClient, queryKeys } from '@/query/queryClient'
import { playerQueriesFor } from '@/lib/playerQueries'
import { playerQueryKeys } from '@/lib/playerQueryKeys'
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import { recordingApi } from '@/test/recordingApi'

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

describe('the retry policy', () => {
  it('gives up at once on a 404 and tries anything else once more', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry ?? null
    const retries = (error: Error) =>
      typeof retry === 'function' ? [0, 1].map((failures) => retry(failures, error)) : []
    expect(retries(new ApiError({ status: 404, message: 'Gone' }))).toEqual([false, false])
    expect(retries(new ApiError({ status: 500, message: 'Broke' }))).toEqual([true, false])
  })
})

describe('shared player query keys', () => {
  it('keeps player caches reachable by the web invalidation keys', async () => {
    const client = createQueryClient()
    const { api } = recordingApi({ body: null })
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
