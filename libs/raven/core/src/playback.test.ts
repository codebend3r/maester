import { describe, expect, it } from 'vitest'
import { checkDirectPlay, planPlayback, streamMimeType, videoCodecString } from '@/playback'
import { chromeLike, mediaItem, safariLike } from '@/test/fixtures'

describe('checkDirectPlay', () => {
  it('plays an H.264/AAC MP4', () => {
    expect(checkDirectPlay({ media: mediaItem(), canPlay: chromeLike })).toEqual({
      playable: true,
      problems: [],
    })
  })

  it('plays a 10-bit HEVC MKV where the browser handles Matroska', () => {
    const media = mediaItem({ container: 'mkv', videoCodec: 'hevc', videoBitDepth: 10 })
    expect(checkDirectPlay({ media, canPlay: chromeLike }).playable).toBe(true)
  })

  it('names the container when the browser cannot open it', () => {
    const media = mediaItem({ container: 'mkv' })
    expect(checkDirectPlay({ media, canPlay: safariLike })).toEqual({
      playable: false,
      problems: ["The MKV container isn't supported here."],
    })
  })

  it('names the audio when only the audio is the problem', () => {
    const media = mediaItem({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'eac3' })
    expect(checkDirectPlay({ media, canPlay: chromeLike })).toEqual({
      playable: false,
      problems: ["Dolby Digital Plus audio isn't supported here."],
    })
  })

  it('lists video and audio problems together', () => {
    const media = mediaItem({ videoCodec: 'vc1', audioCodec: 'dts' })
    expect(checkDirectPlay({ media, canPlay: chromeLike }).problems).toEqual([
      "VC-1 video isn't supported here.",
      "DTS audio isn't supported here.",
    ])
  })

  it('mentions the bit depth when that is what fails', () => {
    const media = mediaItem({ videoBitDepth: 10 })
    const eightBitOnly = (mime: string): boolean => !mime.includes('avc1.6E')
    expect(checkDirectPlay({ media, canPlay: eightBitOnly }).problems).toEqual([
      "10-bit H.264 video isn't supported here.",
    ])
  })

  it('plays a file with no audio track', () => {
    const media = mediaItem({ audioCodec: null, audioChannels: null })
    expect(checkDirectPlay({ media, canPlay: chromeLike }).playable).toBe(true)
  })

  it('gives an unprobed file the benefit of the doubt when the container is fine', () => {
    const media = mediaItem({ videoCodec: null, audioCodec: null, duration: null })
    expect(checkDirectPlay({ media, canPlay: chromeLike }).playable).toBe(true)
  })

  it('rejects containers no browser plays', () => {
    expect(
      checkDirectPlay({ media: mediaItem({ container: 'avi' }), canPlay: chromeLike }).playable,
    ).toBe(false)
  })

  it('asks the client with the exact codec string', () => {
    const asked: string[] = []
    checkDirectPlay({
      media: mediaItem({
        container: 'mkv',
        videoCodec: 'hevc',
        videoBitDepth: 10,
        audioCodec: 'opus',
      }),
      canPlay: (mime) => {
        asked.push(mime)
        return true
      },
    })
    expect(asked).toEqual([
      'video/x-matroska',
      'video/x-matroska; codecs="hvc1.2.4.L153.B0"',
      'video/x-matroska; codecs="opus"',
    ])
  })
})

describe('videoCodecString', () => {
  it('picks the 10-bit profile for deep files', () => {
    expect(videoCodecString({ codec: 'h264', bitDepth: 8 })).toBe('avc1.640028')
    expect(videoCodecString({ codec: 'h264', bitDepth: 10 })).toBe('avc1.6E0028')
    expect(videoCodecString({ codec: 'mpeg2video', bitDepth: 8 })).toBeNull()
  })
})

describe('planPlayback', () => {
  const everything = (): boolean => true
  const nothing = (): boolean => false

  it('plays the original file when it can, keeping conversions in reserve', () => {
    expect(
      planPlayback({
        media: mediaItem(),
        canPlay: chromeLike,
        canStream: everything,
        defaultAudio: true,
      }),
    ).toEqual({ modes: ['direct', 'remux', 'transcode'], problems: [] })
  })

  it('remuxes when only the audio stands in the way', () => {
    const media = mediaItem({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'truehd' })
    expect(
      planPlayback({ media, canPlay: chromeLike, canStream: everything, defaultAudio: true }),
    ).toEqual({
      modes: ['remux', 'transcode'],
      problems: ["Dolby TrueHD audio isn't supported here."],
    })
  })

  it('goes through the server for any audio track but the default', () => {
    const plan = planPlayback({
      media: mediaItem(),
      canPlay: chromeLike,
      canStream: everything,
      defaultAudio: false,
    })
    expect(plan.modes).toEqual(['remux', 'transcode'])
  })

  it('transcodes video the server cannot copy or the browser cannot decode', () => {
    const vc1 = mediaItem({ container: 'mkv', videoCodec: 'vc1' })
    expect(
      planPlayback({ media: vc1, canPlay: chromeLike, canStream: everything, defaultAudio: true })
        .modes,
    ).toEqual(['transcode'])
    const hevc = mediaItem({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'dts' })
    const h264Only = (mime: string): boolean => !mime.includes('hvc1')
    expect(
      planPlayback({ media: hevc, canPlay: chromeLike, canStream: h264Only, defaultAudio: true })
        .modes,
    ).toEqual(['transcode'])
  })

  it('falls back to the default track without Media Source Extensions', () => {
    expect(
      planPlayback({
        media: mediaItem(),
        canPlay: chromeLike,
        canStream: nothing,
        defaultAudio: false,
      }).modes,
    ).toEqual(['direct'])
    const dts = mediaItem({ audioCodec: 'dts' })
    expect(
      planPlayback({ media: dts, canPlay: chromeLike, canStream: nothing, defaultAudio: true })
        .modes,
    ).toEqual([])
  })
})

describe('streamMimeType', () => {
  it('keeps the video for a remux and always uses AAC audio', () => {
    const media = mediaItem({ videoCodec: 'hevc', videoBitDepth: 10, audioCodec: 'truehd' })
    expect(streamMimeType({ media, mode: 'remux' })).toBe(
      'video/mp4; codecs="hvc1.2.4.L153.B0,mp4a.40.2"',
    )
    expect(streamMimeType({ media, mode: 'transcode' })).toBe(
      'video/mp4; codecs="avc1.640028,mp4a.40.2"',
    )
  })

  it('leaves the audio out when the file has none', () => {
    expect(streamMimeType({ media: mediaItem({ audioCodec: null }), mode: 'remux' })).toBe(
      'video/mp4; codecs="avc1.640028"',
    )
  })
})
