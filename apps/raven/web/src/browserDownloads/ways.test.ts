import { type CanPlay, CONTAINERS, DEVICE_DOWNLOAD_VARIANTS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import {
  DOWNLOAD_WAYS,
  downloadWayOf,
  isKeepable,
  keepsDolbyVision,
  VARIANT_OF,
} from '@/browserDownloads/ways'
import { mediaItem } from '@/test/fixtures'

/** A browser that plays exactly the MIME types and codecs named, each matched as a part of what is asked. */
const playing =
  (...parts: string[]): CanPlay =>
  (mimeType) =>
    parts.some((part) => mimeType === part || mimeType.startsWith(`${part};`))

const H264_MP4 = mediaItem({ container: CONTAINERS.mp4, videoCodec: 'h264', videoBitDepth: 8 })
const H264_MKV = mediaItem({ container: CONTAINERS.mkv, videoCodec: 'h264', videoBitDepth: 8 })
const DOLBY_VISION = mediaItem({
  container: CONTAINERS.mkv,
  videoCodec: 'hevc',
  videoBitDepth: 10,
  hdr: true,
  isDolbyVisionOnly: true,
})

describe('downloadWayOf', () => {
  it('keeps the original file when the browser plays it as it is', () => {
    expect(downloadWayOf({ media: H264_MP4, canPlay: playing('video/mp4') })).toBe(
      DOWNLOAD_WAYS.file,
    )
  })

  it('keeps the MP4 copy of an MKV whose picture the browser plays', () => {
    expect(downloadWayOf({ media: H264_MKV, canPlay: playing('video/mp4') })).toBe(
      DOWNLOAD_WAYS.copy,
    )
  })

  it('keeps the Dolby Vision copy where the browser says it plays Dolby Vision, as Safari does', () => {
    const safari: CanPlay = (mimeType) =>
      mimeType.startsWith('video/mp4') || mimeType.startsWith('video/x-matroska')
    expect(downloadWayOf({ media: DOLBY_VISION, canPlay: safari })).toBe(DOWNLOAD_WAYS.copy)
  })

  it('keeps no Dolby Vision only title where the browser does not play Dolby Vision', () => {
    const chrome: CanPlay = (mimeType) => !mimeType.includes('dvh1')
    expect(keepsDolbyVision(chrome)).toBe(false)
    expect(isKeepable({ media: DOLBY_VISION, canPlay: chrome })).toBe(false)
    expect(isKeepable({ media: H264_MKV, canPlay: chrome })).toBe(true)
  })

  it('keeps a Dolby Vision only title where the browser plays it', () => {
    expect(keepsDolbyVision(() => true)).toBe(true)
    expect(isKeepable({ media: DOLBY_VISION, canPlay: () => true })).toBe(true)
  })

  it('keeps the SDR copy of a picture the browser does not play in any container', () => {
    const noHevc: CanPlay = (mimeType) => mimeType === 'video/mp4' || mimeType.includes('avc1')
    const hevc = mediaItem({ container: CONTAINERS.mkv, videoCodec: 'hevc', videoBitDepth: 10 })
    expect(downloadWayOf({ media: hevc, canPlay: noHevc })).toBe(DOWNLOAD_WAYS.sdr)
  })

  it('keeps the SDR copy of a codec it has no name for', () => {
    const odd = mediaItem({ container: 'avi', videoCodec: 'mpeg4', videoBitDepth: 8 })
    expect(downloadWayOf({ media: odd, canPlay: () => true })).toBe(DOWNLOAD_WAYS.sdr)
  })

  it('gives a video not yet probed the benefit of the doubt in a container the browser plays', () => {
    const unprobed = mediaItem({ container: CONTAINERS.mp4, videoCodec: null, audioCodec: null })
    expect(downloadWayOf({ media: unprobed, canPlay: playing('video/mp4') })).toBe(
      DOWNLOAD_WAYS.file,
    )
    const matroska = { ...unprobed, container: CONTAINERS.mkv }
    expect(downloadWayOf({ media: matroska, canPlay: playing('video/mp4') })).toBe(
      DOWNLOAD_WAYS.sdr,
    )
  })

  it('names the copy the server makes for each way', () => {
    expect(VARIANT_OF).toEqual({
      [DOWNLOAD_WAYS.file]: null,
      [DOWNLOAD_WAYS.copy]: DEVICE_DOWNLOAD_VARIANTS.copy,
      [DOWNLOAD_WAYS.sdr]: DEVICE_DOWNLOAD_VARIANTS.sdr,
    })
  })
})
