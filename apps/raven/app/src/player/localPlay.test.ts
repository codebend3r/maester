import { describe, expect, it } from 'bun:test'
import { type MediaItem, ROUTE_STATES, type RouteQuery } from '@raven/core'
import { mediaItemFor } from '@raven/native/testing'

import { PLAY_ORIGINS, playOriginOf } from '@/player/localPlay'
import type { LocalCopy } from '@/player/playWay'

const kept = mediaItemFor({ id: 7, title: 'Kept' })
const fresh = mediaItemFor({ id: 7, title: 'Fresh' })

const local: LocalCopy = { uri: 'file:///media.mp4', tracks: null }
const download = { media: kept, copy: local }

const loading: RouteQuery<MediaItem> = { state: ROUTE_STATES.loading }
const ready: RouteQuery<MediaItem> = { state: ROUTE_STATES.ready, data: fresh }
const missing: RouteQuery<MediaItem> = { state: ROUTE_STATES.missing }

describe('playOriginOf', () => {
  it("plays the server's video with no download, whatever the page says", () => {
    expect(playOriginOf({ kept: null, page: ready, isPatient: true })).toEqual({
      kind: PLAY_ORIGINS.server,
    })
    expect(playOriginOf({ kept: null, page: missing, isPatient: false })).toEqual({
      kind: PLAY_ORIGINS.server,
    })
  })

  it("plays a download from the device as the server's video once the server answers", () => {
    expect(playOriginOf({ kept: download, page: ready, isPatient: true })).toEqual({
      kind: PLAY_ORIGINS.local,
      media: fresh,
      local,
    })
  })

  it('waits for a slow server, then plays what the download kept', () => {
    expect(playOriginOf({ kept: download, page: loading, isPatient: true })).toEqual({
      kind: PLAY_ORIGINS.server,
    })
    expect(playOriginOf({ kept: download, page: loading, isPatient: false })).toEqual({
      kind: PLAY_ORIGINS.local,
      media: kept,
      local,
    })
    expect(playOriginOf({ kept: download, page: missing, isPatient: true })).toEqual({
      kind: PLAY_ORIGINS.local,
      media: kept,
      local,
    })
  })
})
