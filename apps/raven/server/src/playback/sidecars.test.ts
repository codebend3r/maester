import { describe, expect, it } from 'vitest'
import { parseSidecarName } from '@/playback/sidecars'

const videoFileName = 'Movie (2020) 1080p.mkv'
const parse = (fileName: string) => parseSidecarName({ videoFileName, fileName })

describe('parseSidecarName', () => {
  it('reads the language and flags between the name and the extension', () => {
    expect(parse('Movie (2020) 1080p.en.forced.srt')).toEqual({
      codec: 'srt',
      language: 'en',
      title: null,
      forced: true,
      hearingImpaired: false,
    })
    expect(parse('Movie (2020) 1080p.SDH.English.ass')).toMatchObject({
      language: 'en',
      hearingImpaired: true,
    })
  })

  it('takes a bare sidecar as having no language', () => {
    expect(parse('Movie (2020) 1080p.srt')).toEqual({
      codec: 'srt',
      language: null,
      title: null,
      forced: false,
      hearingImpaired: false,
    })
  })

  it('keeps words it does not know as the title', () => {
    expect(parse('Movie (2020) 1080p.ja.Signs and Songs.ass')).toMatchObject({
      language: 'ja',
      title: 'Signs and Songs',
    })
  })

  it('ignores files that belong to another video or are not subtitles', () => {
    expect(parse('Other Movie.en.srt')).toBeNull()
    expect(parse('Movie (2020) 1080p.nfo')).toBeNull()
    expect(parse('Movie (2020) 1080p.mkv')).toBeNull()
  })

  it('matches the name case-insensitively', () => {
    expect(parse('movie (2020) 1080P.EN.SRT')).toMatchObject({ codec: 'srt', language: 'en' })
  })
})
