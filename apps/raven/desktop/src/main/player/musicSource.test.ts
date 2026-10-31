import { PLAYER_SOURCE_KINDS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import type { ServerTarget } from '@/main/player/loadTarget'
import { createMusicResolve } from '@/main/player/musicSource'
import { SERVER_A } from '@/main/test/downloadEntries'

const TRACK = `/data/downloads/${SERVER_A}/7/media.flac`

const serverTarget = (mediaId: number): ServerTarget => ({
  kind: PLAYER_SOURCE_KINDS.server,
  serverId: SERVER_A,
  mediaId,
  url: `http://127.0.0.1:41234/secret-${mediaId}/file`,
  sidecars: [],
  relay: { loadId: String(mediaId), base: `http://127.0.0.1:41234/secret-${mediaId}` },
})

type SetupProps = { downloaded: Readonly<Record<number, string>> }

const setup = ({ downloaded }: SetupProps) => {
  const asked: number[] = []
  const looked: { serverId: string; mediaId: number }[] = []
  const resolve = createMusicResolve({
    sources: {
      resolve: async ({ mediaId }) => {
        asked.push(mediaId)
        return { ok: true, target: serverTarget(mediaId) }
      },
    },
    downloads: {
      trackPathOf: async (input) => {
        looked.push(input)
        return downloaded[input.mediaId] ?? null
      },
    },
    serverId: () => SERVER_A,
  })
  return { resolve, asked, looked }
}

describe('createMusicResolve', () => {
  it("plays a downloaded track's file and asks the server for no ticket", async () => {
    const { resolve, asked, looked } = setup({ downloaded: { 7: TRACK } })
    expect(await resolve(7)).toEqual({
      ok: true,
      target: { kind: PLAYER_SOURCE_KINDS.file, path: TRACK, sidecars: [] },
    })
    expect(looked).toEqual([{ serverId: SERVER_A, mediaId: 7 }])
    expect(asked).toEqual([])
  })

  it('asks the server for a track with no download', async () => {
    const { resolve, asked } = setup({ downloaded: {} })
    expect(await resolve(8)).toEqual({ ok: true, target: serverTarget(8) })
    expect(asked).toEqual([8])
  })
})
