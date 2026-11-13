import { describe, expect, it } from 'bun:test'
import { CONTAINERS, VIDEO_CODECS, createApiClient } from '@raven/core'
import { mediaItemFor } from '@raven/native/testing'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import {
  DOWNLOAD_KINDS,
  DOWNLOAD_STATES,
  DOWNLOAD_WAYS,
  type DownloadEntry,
  GROUP_KINDS,
} from '@/downloads/downloadEntries'
import {
  episodeTargetOf,
  fileTargetOf,
  itemTargetOf,
  movieTargetOf,
  seasonTargetOf,
  showTargetOf,
  videoTargetOf,
} from '@/downloads/downloadTargets'
import { APP_PLATFORMS } from '@/platform/platform'
import {
  BUSBOYS,
  BUSBOYS_FILE,
  GOOD_NEWS,
  GOOD_NEWS_ABOUT_HELL,
  SEVERANCE,
  SEVERANCE_ONE,
} from '@/test/itemServer'

const api = createApiClient({
  baseUrl: 'https://nas.example',
  fetch: () => Promise.reject(new Error('a target asks the server nothing until pressed')),
})

const platform = APP_PLATFORMS.ios

type EntryOfProps = { mediaId: number; season: number }

/** A finished episode of Severance, under the season it is in. */
const entryOf = ({ mediaId, season }: EntryOfProps): DownloadEntry => ({
  kind: DOWNLOAD_KINDS.video,
  serverId: 'raven',
  mediaId,
  title: 'Episode',
  line: 'S01E01',
  group: {
    kind: GROUP_KINDS.show,
    id: SEVERANCE.id,
    title: SEVERANCE.title,
    season,
    library: null,
  },
  order: 1,
  way: DOWNLOAD_WAYS.file,
  path: `downloads/raven/${mediaId}/media.mp4`,
  artUri: null,
  artPath: null,
  logoUri: null,
  logoPath: null,
  status: { state: DOWNLOAD_STATES.done, bytes: 1_000 },
  addedAt: 1,
  stamp: 1,
  place: 1,
  media: mediaItemFor({ id: mediaId }),
  tracks: null,
})

const EPISODE_ONE = entryOf({ mediaId: 12, season: 1 })
const EPISODE_OF_TWO = entryOf({ mediaId: 30, season: 2 })

const EPISODE_FILE = GOOD_NEWS.primary ?? mediaItemFor()

describe('movieTargetOf', () => {
  it("stands for the movie's one file, by its name, and asks for it under the movie", async () => {
    const target = movieTargetOf({ api, platform, details: BUSBOYS, media: BUSBOYS_FILE })
    expect(target.name).toBe('Busboys')
    expect(target.wanted).toBe(1)
    expect(target.blocked).toBeNull()
    expect(target.isFor(entryOf({ mediaId: BUSBOYS_FILE.id, season: 0 }))).toBe(true)
    expect(target.isFor(EPISODE_ONE)).toBe(false)
    const asks = await target.asks()
    expect(asks.map(({ group }) => group.kind)).toEqual([GROUP_KINDS.movie])
  })

  it('says why where this device can take the file no way', () => {
    const vp9 = mediaItemFor({ container: CONTAINERS.webm, videoCodec: VIDEO_CODECS.vp9 })
    expect(movieTargetOf({ api, platform, details: BUSBOYS, media: vp9 }).blocked).not.toBeNull()
  })
})

describe('episodeTargetOf', () => {
  it("asks for the episode under its show's season, wearing the show's poster", async () => {
    const target = episodeTargetOf({
      api,
      platform,
      details: GOOD_NEWS_ABOUT_HELL,
      media: EPISODE_FILE,
      show: SEVERANCE,
    })
    expect(target.isFor(EPISODE_ONE)).toBe(true)
    const [ask] = await target.asks()
    expect(ask?.group).toEqual({
      kind: GROUP_KINDS.show,
      id: SEVERANCE.id,
      title: SEVERANCE.title,
      season: 1,
    })
    expect(ask?.artUri).not.toBeNull()
  })
})

describe('fileTargetOf', () => {
  it('stands for a lone file under its own name', async () => {
    const target = fileTargetOf({ api, platform, media: BUSBOYS_FILE })
    expect(target.name).toBe(BUSBOYS_FILE.title)
    const [ask] = await target.asks()
    expect(ask?.group.kind).toBe(GROUP_KINDS.video)
  })
})

describe('videoTargetOf', () => {
  it("picks the movie's, the episode's or the file's by the page it has", () => {
    const movie = videoTargetOf({
      api,
      platform,
      media: BUSBOYS_FILE,
      details: BUSBOYS,
      show: null,
    })
    const episode = videoTargetOf({
      api,
      platform,
      media: EPISODE_FILE,
      details: GOOD_NEWS_ABOUT_HELL,
      show: null,
    })
    const file = videoTargetOf({ api, platform, media: BUSBOYS_FILE, details: null, show: null })
    expect(movie.name).toBe(BUSBOYS.title)
    expect(episode.name).toBe(GOOD_NEWS_ABOUT_HELL.title)
    expect(file.name).toBe(BUSBOYS_FILE.title)
  })
})

describe('seasonTargetOf', () => {
  it("stands for the season's episodes this device can take, and not another season's", () => {
    const target = seasonTargetOf({ api, platform, season: SEVERANCE_ONE, show: SEVERANCE })
    expect(target.name).toBe('Season 1')
    expect(target.wanted).toBe(2)
    expect(target.blocked).toBeNull()
    expect(target.isFor(EPISODE_ONE)).toBe(true)
    expect(target.isFor(EPISODE_OF_TWO)).toBe(false)
  })

  it('says a season with no file to take cannot download', () => {
    const bare = { ...SEVERANCE_ONE, children: [] }
    expect(seasonTargetOf({ api, platform, season: bare, show: null }).blocked).toBe(
      DOWNLOAD_COPY.cantDownload,
    )
  })
})

describe('showTargetOf', () => {
  it("counts every season's episodes and stands for every season's downloads", () => {
    const target = showTargetOf({ api, platform, show: SEVERANCE })
    expect(target.name).toBe('Severance')
    expect(target.wanted).toBe(4)
    expect(target.blocked).toBeNull()
    expect(target.isFor(EPISODE_ONE)).toBe(true)
    expect(target.isFor(EPISODE_OF_TWO)).toBe(true)
  })

  it('says a show with no seasons cannot download', () => {
    expect(showTargetOf({ api, platform, show: BUSBOYS }).blocked).toBe(DOWNLOAD_COPY.cantDownload)
  })
})

describe('itemTargetOf', () => {
  it("is the season's for a season and the show's for anything else", () => {
    expect(itemTargetOf({ api, platform, details: SEVERANCE_ONE, show: SEVERANCE }).name).toBe(
      'Season 1',
    )
    expect(itemTargetOf({ api, platform, details: SEVERANCE, show: null }).name).toBe('Severance')
  })
})
