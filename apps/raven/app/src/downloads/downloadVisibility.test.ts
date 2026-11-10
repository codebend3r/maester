import { describe, expect, it } from 'bun:test'

import { DOWNLOAD_STATES } from '@/downloads/downloadEntries'
import { downloadedVideoOf, trackPlanFor, visibleEntriesOf } from '@/downloads/downloadVisibility'
import {
  ALBUM_GROUP,
  DONE_STATUS,
  DOWNLOADS_SERVER_ID,
  SEASON_GROUP,
  SERIES_LIBRARY,
  VAULT_LIBRARY,
  downloadKeyFor,
  recordOf,
  trackEntryOf,
  videoEntryOf,
} from '@/test/downloadFixtures'
import { AIRBAG, PARANOID } from '@/test/musicServer'

describe('visibleEntriesOf', () => {
  const hidden = videoEntryOf({
    id: 1,
    status: DONE_STATUS,
    group: { ...SEASON_GROUP, library: VAULT_LIBRARY },
  })
  const shown = videoEntryOf({
    id: 2,
    status: DONE_STATUS,
    group: { ...SEASON_GROUP, library: SERIES_LIBRARY },
  })
  const unfiled = videoEntryOf({ id: 3, status: DONE_STATUS })

  it("leaves out a locked library's downloads without the unlock, and keeps every other", () => {
    const entries = recordOf([hidden, shown, unfiled])
    expect(Object.keys(visibleEntriesOf({ entries, isUnlocked: false }))).toEqual([
      downloadKeyFor(2),
      downloadKeyFor(3),
    ])
    expect(visibleEntriesOf({ entries, isUnlocked: true })).toEqual(entries)
  })
})

describe('the downloads as the players read them', () => {
  const entries = recordOf([
    videoEntryOf({ id: 1, status: DONE_STATUS }),
    videoEntryOf({ id: 2, status: { state: DOWNLOAD_STATES.queued, preparing: null } }),
    trackEntryOf({ track: AIRBAG, addedAt: 1 }),
  ])

  type FindVideoProps = { mediaId: number; isUnlocked?: boolean }

  const findVideo = ({ mediaId, isUnlocked = false }: FindVideoProps) =>
    downloadedVideoOf({ entries, serverId: DOWNLOADS_SERVER_ID, mediaId, isUnlocked })

  it('finds a finished video alone', () => {
    expect(findVideo({ mediaId: 1 })?.mediaId).toBe(1)
    expect(findVideo({ mediaId: 2 })).toBeNull()
    expect(findVideo({ mediaId: AIRBAG.id })).toBeNull()
  })

  it("finds a locked library's video only with the unlock", () => {
    const vaulted = recordOf([
      videoEntryOf({
        id: 1,
        status: DONE_STATUS,
        group: { ...SEASON_GROUP, library: VAULT_LIBRARY },
      }),
    ])
    const find = (isUnlocked: boolean) =>
      downloadedVideoOf({ entries: vaulted, serverId: DOWNLOADS_SERVER_ID, mediaId: 1, isUnlocked })
    expect(find(false)).toBeNull()
    expect(find(true)?.mediaId).toBe(1)
  })

  it('plays a downloaded track from its file and its saved cover', () => {
    const plan = trackPlanFor({
      serverId: DOWNLOADS_SERVER_ID,
      read: () => ({ entries, isUnlocked: false, uriOf: (path) => `file:///${path}` }),
    })
    expect(plan.downloadedOf(AIRBAG)).toEqual({
      uri: `file:///downloads/raven/${AIRBAG.id}/media.flac`,
      artworkUri: `file:///downloads/raven/${AIRBAG.id}/art.jpg`,
    })
    expect(plan.downloadedOf(PARANOID)).toBeNull()
  })

  it("plays a locked library's track from the server until the unlock is held", () => {
    const vaulted = recordOf([
      {
        ...trackEntryOf({ track: AIRBAG, addedAt: 1 }),
        group: { ...ALBUM_GROUP, library: VAULT_LIBRARY },
      },
    ])
    const planOf = (isUnlocked: boolean) =>
      trackPlanFor({
        serverId: DOWNLOADS_SERVER_ID,
        read: () => ({ entries: vaulted, isUnlocked, uriOf: (path) => `file:///${path}` }),
      })
    expect(planOf(false).downloadedOf(AIRBAG)).toBeNull()
    expect(planOf(true).downloadedOf(AIRBAG)).not.toBeNull()
  })
})
