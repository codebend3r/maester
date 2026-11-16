import { describe, expect, it, mock } from 'bun:test'
import { type PictureCue, type SubtitleTrack, SUBTITLE_SOURCES } from '@raven/core'
import { QueryClient } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { api } from '@/test/api'
import { usePictureCues } from '@/lib/usePictureCues'
import { renderQueryHook } from '@/test/renderQueryHook'

const TRACK = {
  id: 'embedded-2',
  source: SUBTITLE_SOURCES.embedded,
  codec: 'hdmv_pgs_subtitle',
  language: 'en',
  title: null,
  default: false,
  forced: false,
  hasPictureCues: true,
  hearingImpaired: false,
  supported: false,
} as const satisfies SubtitleTrack

const cueAt = (start: number): PictureCue => ({
  start,
  end: start + 2,
  canvas: { width: 1920, height: 1080 },
  pictures: [{ x: 0, y: 900, width: 1920, height: 120, png: 'iVBOR' }],
})

describe('usePictureCues', () => {
  it('reads the playing window of a picture track and hands its cues in time order', async () => {
    const getPictureSubtitles = mock(async () => [cueAt(12), cueAt(4)])
    const client = new QueryClient()
    const { result } = renderQueryHook({
      client,
      hook: () =>
        usePictureCues({
          video: { api: { ...api, getPictureSubtitles }, mediaId: 7 },
          track: TRACK,
          time: 5,
          duration: 120,
        }),
    })
    await waitFor(() => expect(result.current.map((cue) => cue.start)).toEqual([4, 12]))
    expect(getPictureSubtitles).toHaveBeenCalledWith({
      id: 7,
      trackId: TRACK.id,
      window: 0,
      access: null,
    })
    client.clear()
  })

  it('asks for nothing without a track', () => {
    const getPictureSubtitles = mock(async () => [cueAt(4)])
    const client = new QueryClient()
    const { result } = renderQueryHook({
      client,
      hook: () =>
        usePictureCues({
          video: { api: { ...api, getPictureSubtitles }, mediaId: 7 },
          track: null,
          time: 5,
          duration: 120,
        }),
    })
    expect(result.current).toEqual([])
    expect(getPictureSubtitles).not.toHaveBeenCalled()
    client.clear()
  })
})
