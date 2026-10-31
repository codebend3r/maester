import { DOWNLOAD_STATUS_KINDS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import type { DownloadEntry } from '@/main/downloads/downloadState'
import {
  DOWNLOADS,
  FILE,
  ID,
  OTHER_SERVER_ID,
  SERVER_ID,
  entryFor,
  setup,
} from '@/main/test/playbackWorld'

describe('trackPathOf', () => {
  const TRACK = `${DOWNLOADS}/${SERVER_ID}/31/media.flac`
  const trackFor = (overrides: Partial<DownloadEntry> = {}): DownloadEntry =>
    entryFor({
      mediaId: 31,
      label: 'Airbag',
      container: 'flac',
      group: {
        kind: 'album',
        key: 'album:7',
        sourceId: 7,
        title: 'OK Computer',
        order: 1,
        cover: { albumId: 7, coverVersion: 'cover-v1' },
      },
      ...overrides,
    })

  it("finds a track's ready download, granting nothing and leaving the page where it was", async () => {
    const world = setup({ entries: [trackFor()], videos: { [TRACK]: FILE } })
    expect(await world.playback.trackPathOf({ serverId: SERVER_ID, mediaId: 31 })).toBe(TRACK)
    expect(world.playback.isPlaying(ID)).toBe(false)
  })

  it('never offers the part of a track still downloading', async () => {
    const world = setup({
      entries: [trackFor({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 10 } })],
      videos: { [`${TRACK}.part`]: FILE },
    })
    expect(await world.playback.trackPathOf({ serverId: SERVER_ID, mediaId: 31 })).toBeNull()
    expect(world.statted).toEqual([])
  })

  it('offers nothing for a track with no download, or on another server', async () => {
    const world = setup({ entries: [trackFor()], videos: { [TRACK]: FILE } })
    expect(await world.playback.trackPathOf({ serverId: SERVER_ID, mediaId: 99 })).toBeNull()
    expect(await world.playback.trackPathOf({ serverId: OTHER_SERVER_ID, mediaId: 31 })).toBeNull()
  })

  it('offers nothing, with a warning, for a download whose file has gone', async () => {
    const world = setup({ entries: [trackFor()] })
    expect(await world.playback.trackPathOf({ serverId: SERVER_ID, mediaId: 31 })).toBeNull()
    expect(world.warnings).toEqual(['Raven could not open the file of Airbag'])
  })
})
