import { describe, expect, it } from 'bun:test'
import { AUDIO_BITRATES, AUDIO_CODECS, CONTAINERS, type Track } from '@raven/core'

import {
  DOWNLOAD_KINDS,
  DOWNLOAD_STATES,
  DOWNLOAD_WAYS,
  entriesOf,
  entryOf,
} from '@/downloads/downloadEntries'
import {
  ALBUM_GROUP,
  DOWNLOADS_SERVER_ID,
  SEASON_GROUP,
  videoEntryOf,
} from '@/test/downloadFixtures'
import { mediaItemFor } from '@/test/mediaItem'
import { AIRBAG } from '@/test/musicServer'

describe('entriesOf', () => {
  it('reads back only what passes the guard, a stopped download queued again', () => {
    const saved = {
      entries: {
        a: videoEntryOf({ id: 2, status: { state: DOWNLOAD_STATES.downloading } }),
        b: { mediaId: 'nope' },
      },
    }
    expect(Object.values(entriesOf(saved)).map(({ status }) => status)).toEqual([
      { state: DOWNLOAD_STATES.queued, preparing: null },
    ])
    expect(entriesOf('junk')).toEqual({})
  })
})

describe('entryOf', () => {
  const asked = { serverId: DOWNLOADS_SERVER_ID, artUri: null, logoUri: null, addedAt: 1, stamp: 1 }

  it('queues a video at its place, its file named for the way it comes', () => {
    const media = mediaItemFor({ id: 12, title: 'Pilot', container: CONTAINERS.mkv })
    const entry = entryOf({
      ...asked,
      group: SEASON_GROUP,
      place: 4,
      item: {
        kind: DOWNLOAD_KINDS.video,
        media,
        way: DOWNLOAD_WAYS.copy,
        title: 'Pilot',
        line: 'S01E01',
        order: 1,
      },
    })
    expect(entry).toMatchObject({
      kind: DOWNLOAD_KINDS.video,
      mediaId: 12,
      place: 4,
      path: 'downloads/raven/12/media.mp4',
      status: { state: DOWNLOAD_STATES.queued, preparing: null },
      tracks: null,
    })
  })

  it('queues a track as its file, or as AAC where AVPlayer cannot decode it', () => {
    const opus: Track = { ...AIRBAG, codec: AUDIO_CODECS.opus, container: CONTAINERS.webm }
    const itemOf = (track: Track) => ({
      kind: DOWNLOAD_KINDS.track,
      track,
      title: track.title,
      line: 'Radiohead',
      order: 1,
    })
    const file = entryOf({ ...asked, group: ALBUM_GROUP, place: 0, item: itemOf(AIRBAG) })
    const transcode = entryOf({ ...asked, group: ALBUM_GROUP, place: 1, item: itemOf(opus) })
    expect(file).toMatchObject({ way: DOWNLOAD_WAYS.file, kbps: null })
    expect(file.path.endsWith(`.${AIRBAG.container}`)).toBe(true)
    expect(transcode).toMatchObject({
      way: DOWNLOAD_WAYS.transcode,
      kbps: AUDIO_BITRATES.standard,
      path: `downloads/raven/${opus.id}/media.m4a`,
    })
  })
})
