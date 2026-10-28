import { describe, expect, it } from 'bun:test'
import {
  type PlaybackPolicy,
  checkDirectPlay,
  containerMimeType,
  offeredQualities,
  planPlayback,
  streamMimeType,
  videoCodecString,
} from '@/playback'
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
  const standard: PlaybackPolicy = { directPlay: 'auto', transcoding: 'on' }

  it('follows the server policy: forced direct, remux only, or nothing converted', () => {
    const media = mediaItem({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'eac3' })
    // Safari takes no Matroska, so the file cannot play as it is; Chrome can stream both ways.
    const base = { media, canPlay: safariLike, canStream: chromeLike, defaultAudio: true }
    expect(planPlayback({ ...base, policy: standard }).modes).toEqual(['remux', 'transcode'])
    expect(
      planPlayback({ ...base, policy: { directPlay: 'force', transcoding: 'on' } }).modes,
    ).toEqual(['direct'])
    expect(
      planPlayback({ ...base, policy: { directPlay: 'auto', transcoding: 'remuxOnly' } }).modes,
    ).toEqual(['remux'])
    expect(
      planPlayback({ ...base, policy: { directPlay: 'auto', transcoding: 'off' } }).modes,
    ).toEqual([])
  })

  const everything = (): boolean => true
  const nothing = (): boolean => false

  it('plays the original file when it can, keeping conversions in reserve', () => {
    expect(
      planPlayback({
        media: mediaItem(),
        canPlay: chromeLike,
        canStream: everything,
        defaultAudio: true,
        policy: standard,
      }),
    ).toEqual({ modes: ['direct', 'remux', 'transcode'], problems: [] })
  })

  it('remuxes when only the audio stands in the way', () => {
    const media = mediaItem({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'truehd' })
    expect(
      planPlayback({
        media,
        canPlay: chromeLike,
        canStream: everything,
        defaultAudio: true,
        policy: standard,
      }),
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
      policy: standard,
    })
    expect(plan.modes).toEqual(['remux', 'transcode'])
  })

  it('sends the original file when forced, remuxing it only for another audio track', () => {
    const media = mediaItem({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'eac3' })
    const forced = { media, canPlay: safariLike, canStream: chromeLike }
    const policy: PlaybackPolicy = { directPlay: 'force', transcoding: 'on' }
    expect(planPlayback({ ...forced, defaultAudio: true, policy }).modes).toEqual(['direct'])
    expect(planPlayback({ ...forced, defaultAudio: false, policy }).modes).toEqual([
      'remux',
      'direct',
    ])
    // With nothing converted, the original file plays its own track.
    expect(
      planPlayback({
        ...forced,
        defaultAudio: false,
        policy: { directPlay: 'force', transcoding: 'off' },
      }).modes,
    ).toEqual(['direct'])
  })

  it('transcodes video the server cannot copy or the browser cannot decode', () => {
    const vc1 = mediaItem({ container: 'mkv', videoCodec: 'vc1' })
    expect(
      planPlayback({
        media: vc1,
        canPlay: chromeLike,
        canStream: everything,
        defaultAudio: true,
        policy: standard,
      }).modes,
    ).toEqual(['transcode'])
    const hevc = mediaItem({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'dts' })
    const h264Only = (mime: string): boolean => !mime.includes('hvc1')
    expect(
      planPlayback({
        media: hevc,
        canPlay: chromeLike,
        canStream: h264Only,
        defaultAudio: true,
        policy: standard,
      }).modes,
    ).toEqual(['transcode'])
  })

  it('falls back to the default track without Media Source Extensions', () => {
    expect(
      planPlayback({
        media: mediaItem(),
        canPlay: chromeLike,
        canStream: nothing,
        defaultAudio: false,
        policy: standard,
      }).modes,
    ).toEqual(['direct'])
    const dts = mediaItem({ audioCodec: 'dts' })
    expect(
      planPlayback({
        media: dts,
        canPlay: chromeLike,
        canStream: nothing,
        defaultAudio: true,
        policy: standard,
      }).modes,
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

  it('streams an audio file as AAC audio alone', () => {
    const media = mediaItem({ container: 'flac', videoCodec: null, audioCodec: 'flac' })
    expect(streamMimeType({ media, mode: 'remux' })).toBe('audio/mp4; codecs="mp4a.40.2"')
  })

  it('leaves the audio out when the file has none', () => {
    expect(streamMimeType({ media: mediaItem({ audioCodec: null }), mode: 'remux' })).toBe(
      'video/mp4; codecs="avc1.640028"',
    )
  })
})

describe('containerMimeType', () => {
  it('serves audio files as their audio types', () => {
    expect(containerMimeType('mp3')).toBe('audio/mpeg')
    expect(containerMimeType('m4a')).toBe('audio/mp4')
    expect(containerMimeType('flac')).toBe('audio/flac')
    expect(containerMimeType('opus')).toBe('audio/ogg')
    expect(containerMimeType('ape')).toBeNull()
  })
})

describe('an audio file', () => {
  const flac = mediaItem({
    container: 'flac',
    videoCodec: null,
    videoBitDepth: null,
    width: null,
    height: null,
    audioCodec: 'flac',
    bitrate: 900_000,
  })
  const standard: PlaybackPolicy = { directPlay: 'auto', transcoding: 'on' }

  it('plays as it is where it can, and is otherwise converted once, with no transcode', () => {
    const everything = (): boolean => true
    const nothing = (): boolean => false
    const base = { media: flac, canStream: everything, defaultAudio: true, policy: standard }
    expect(planPlayback({ ...base, canPlay: everything }).modes).toEqual(['direct', 'remux'])
    expect(planPlayback({ ...base, canPlay: nothing }).modes).toEqual(['remux'])
  })

  it('is offered no sizes to convert down to', () => {
    expect(offeredQualities({ media: flac, maxHeight: 2160 })).toEqual([])
  })
})

describe('offeredQualities', () => {
  it('lists the sizes below the file, largest first', () => {
    const uhd = mediaItem({ width: 3840, height: 2160, bitrate: 24_200_000 })
    expect(offeredQualities({ media: uhd, maxHeight: 2160 })).toEqual([
      'high1080',
      'medium1080',
      'standard1080',
      'low1080',
      'high720',
      'medium720',
      'low720',
      'sd480',
      'mobile328',
    ])
  })

  it('leaves out what the file or the server’s cap is already under', () => {
    const hd = mediaItem({ width: 1920, height: 1080, bitrate: 9_000_000 })
    expect(offeredQualities({ media: hd, maxHeight: 1080 })).toEqual([
      'low1080',
      'high720',
      'medium720',
      'low720',
      'sd480',
      'mobile328',
    ])
    expect(offeredQualities({ media: hd, maxHeight: 720 })).toEqual([
      'high720',
      'medium720',
      'low720',
      'sd480',
      'mobile328',
    ])
  })

  it('offers every size within the cap for a file not probed yet', () => {
    const unprobed = mediaItem({ width: null, height: null, bitrate: null })
    expect(offeredQualities({ media: unprobed, maxHeight: 720 })).toHaveLength(5)
  })
})
