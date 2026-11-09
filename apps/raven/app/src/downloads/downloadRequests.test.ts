import { describe, expect, it } from 'bun:test'
import { AUDIO_CODECS, CONTAINERS, VIDEO_CODECS, createApiClient } from '@raven/core'

import { DOWNLOAD_KINDS, DOWNLOAD_WAYS, GROUP_KINDS } from '@/downloads/downloadEntries'
import { fileAskOf } from '@/downloads/downloadRequests'
import { APP_PLATFORMS } from '@/platform/platform'
import { mediaItemFor } from '@/test/mediaItem'

const ORIGIN = 'https://nas.example'

const api = createApiClient({
  baseUrl: ORIGIN,
  fetch: () => Promise.reject(new Error('fileAskOf asks the server nothing')),
})

const PLAYABLE = mediaItemFor({
  id: 9,
  title: 'Home video',
  duration: 125,
  container: CONTAINERS.mp4,
  videoCodec: VIDEO_CODECS.h264,
  videoBitDepth: 8,
  audioCodec: AUDIO_CODECS.aac,
})

describe('fileAskOf', () => {
  it('asks for a lone video under itself, wearing its frame grab, with its length as its line', () => {
    const ask = fileAskOf({ api, platform: APP_PLATFORMS.ios, media: PLAYABLE })
    expect(ask.group).toEqual({
      kind: GROUP_KINDS.video,
      id: 9,
      title: 'Home video',
      season: null,
    })
    expect(ask.artUri).toBe(api.thumbnailUrl(PLAYABLE))
    expect(ask.artUri?.startsWith(ORIGIN)).toBe(true)
    expect(ask.logoUri).toBeNull()
    expect(ask.items).toEqual([
      {
        kind: DOWNLOAD_KINDS.video,
        media: PLAYABLE,
        way: DOWNLOAD_WAYS.file,
        title: 'Home video',
        line: '2m',
        order: 0,
      },
    ])
  })

  it('asks for nothing where this device can take the video no way', () => {
    const vp9 = mediaItemFor({ container: CONTAINERS.webm, videoCodec: VIDEO_CODECS.vp9 })
    expect(fileAskOf({ api, platform: APP_PLATFORMS.ios, media: vp9 }).items).toEqual([])
  })
})
