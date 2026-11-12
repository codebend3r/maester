import { AUDIO_CODECS, type AudioTrack } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { TONEMAP_FILTER } from '@/ffmpeg/args'
import { SDR_PICTURES, sdrDownloadArgs, sdrPictureOf } from '@/ffmpeg/sdrDownloadArgs'

type TrackProps = { index: number; codec: string }

const track = ({ index, codec }: TrackProps): AudioTrack => ({
  index,
  codec,
  channels: 6,
  language: null,
  title: null,
  default: false,
})

type AfterProps = { args: readonly string[]; flag: string }

const after = ({ args, flag }: AfterProps): string | undefined => args[args.indexOf(flag) + 1]

const FIT =
  "w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"

describe('sdrPictureOf', () => {
  it('only scales a picture that is SDR already, whatever filters there are', () => {
    expect(sdrPictureOf({ isHdr: false, canTonemap: true })).toBe(SDR_PICTURES.plain)
    expect(sdrPictureOf({ isHdr: false, canTonemap: false })).toBe(SDR_PICTURES.plain)
  })

  it('tone maps HDR with zscale where it is there, and leaves it as it is where not', () => {
    expect(sdrPictureOf({ isHdr: true, canTonemap: true })).toBe(SDR_PICTURES.tonemap)
    expect(sdrPictureOf({ isHdr: true, canTonemap: false })).toBe(SDR_PICTURES.plain)
  })
})

describe('sdrDownloadArgs', () => {
  const base = {
    input: '/in.mkv',
    output: '/out.mp4',
    audio: [],
    defaultAudio: null,
    textSubtitles: [],
  }

  it('encodes 8-bit High profile H.264 on the CPU into a faststart MP4 with progress on stdout', () => {
    const args = sdrDownloadArgs({ ...base, picture: SDR_PICTURES.plain })
    expect(args.join(' ')).toContain('-map 0:V:0')
    expect(after({ args, flag: '-c:v' })).toBe('libx264')
    expect(after({ args, flag: '-profile:v' })).toBe('high')
    expect(after({ args, flag: '-pix_fmt' })).toBe('yuv420p')
    expect(after({ args, flag: '-crf' })).toBe('20')
    expect(after({ args, flag: '-movflags' })).toBe('+faststart')
    expect(after({ args, flag: '-progress' })).toBe('pipe:1')
    expect(after({ args, flag: '-f' })).toBe('mp4')
    expect(args.at(-1)).toBe('/out.mp4')
    expect(args).not.toContain('-c:a')
  })

  it('only fits an SDR picture inside 1080p and brings it to 8 bits', () => {
    const args = sdrDownloadArgs({ ...base, picture: SDR_PICTURES.plain })
    expect(after({ args, flag: '-vf' })).toBe(`scale=${FIT},format=yuv420p`)
  })

  it('tone maps HDR with zscale after scaling it', () => {
    const args = sdrDownloadArgs({ ...base, picture: SDR_PICTURES.tonemap })
    expect(after({ args, flag: '-vf' })).toBe(`scale=${FIT},${TONEMAP_FILTER}`)
  })

  it('carries every audio track as AAC stereo, the default one first and alone flagged', () => {
    const args = sdrDownloadArgs({
      ...base,
      picture: SDR_PICTURES.plain,
      audio: [
        track({ index: 0, codec: AUDIO_CODECS.truehd }),
        track({ index: 1, codec: AUDIO_CODECS.eac3 }),
        track({ index: 2, codec: AUDIO_CODECS.aac }),
      ],
      defaultAudio: 1,
    })
    expect(args.join(' ')).toContain('-map 0:V:0 -map 0:a:1 -map 0:a:0 -map 0:a:2')
    expect(args.join(' ')).toContain('-c:a aac -ac 2 -b:a 192k')
    expect(after({ args, flag: '-disposition:a:0' })).toBe('default')
    expect(after({ args, flag: '-disposition:a:1' })).toBe('0')
    expect(after({ args, flag: '-disposition:a:2' })).toBe('0')
  })

  it('maps only the text subtitles it is given, as mov_text', () => {
    const args = sdrDownloadArgs({ ...base, picture: SDR_PICTURES.plain, textSubtitles: [0, 2] })
    expect(args.join(' ')).toContain('-map 0:s:0 -map 0:s:2')
    expect(after({ args, flag: '-c:s' })).toBe('mov_text')
    expect(sdrDownloadArgs({ ...base, picture: SDR_PICTURES.plain })).not.toContain('-c:s')
  })
})
