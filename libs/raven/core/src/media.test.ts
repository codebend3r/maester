import { describe, expect, it } from 'bun:test'
import {
  MEDIA_EXTENSIONS,
  containerOf,
  isAudioContainer,
  isVideoFile,
  resolutionLabel,
  splitResolution,
  titleFromFileName,
} from '@/media'

describe('isVideoFile', () => {
  it.each(['a.mkv', 'b.MP4', 'c.m4v', 'd.webm', 'e.ts'])('accepts %s', (name) => {
    expect(isVideoFile(name)).toBe(true)
  })

  it.each(['a.srt', 'b.nfo', 'c.jpg', 'README', '.mkv'])('rejects %s', (name) => {
    expect(isVideoFile(name)).toBe(false)
  })
})

describe('containerOf', () => {
  it('folds aliases into the container a player cares about', () => {
    expect(containerOf('x.m4v')).toBe('mp4')
    expect(containerOf('x.MKV')).toBe('mkv')
    expect(containerOf('x.mts')).toBe('m2ts')
    expect(containerOf('x.m4b')).toBe('m4a')
    expect(containerOf('x.oga')).toBe('ogg')
    expect(containerOf('x.AIF')).toBe('aiff')
  })
})

describe('isAudioContainer', () => {
  it('knows every audio extension once folded into its container', () => {
    MEDIA_EXTENSIONS.audio.forEach((extension) => {
      expect(isAudioContainer(containerOf(`x.${extension}`))).toBe(true)
    })
  })

  it('takes no video container for audio', () => {
    MEDIA_EXTENSIONS.video.forEach((extension) => {
      expect(isAudioContainer(containerOf(`x.${extension}`))).toBe(false)
    })
  })
})

describe('titleFromFileName', () => {
  it('turns scene-style separators into spaces', () => {
    expect(titleFromFileName('The.Matrix.1999.1080p.mkv')).toBe('The Matrix 1999 1080p')
    expect(titleFromFileName('home_video_2019.mp4')).toBe('home video 2019')
  })

  it('keeps a name that already has its own spacing', () => {
    expect(titleFromFileName('Busboys (2026) 1080p WEBRip.mkv')).toBe('Busboys (2026) 1080p WEBRip')
    expect(titleFromFileName('Mr. Robot - S01E01.mkv')).toBe('Mr. Robot - S01E01')
  })
})

describe('resolutionLabel', () => {
  it.each([
    [{ width: 7680, height: 4320 }, '8K'],
    [{ width: 7680, height: 3200 }, '8K'],
    [{ width: 3840, height: 2160 }, '4K'],
    [{ width: 3840, height: 1600 }, '4K'],
    [{ width: 1920, height: 800 }, '1080p'],
    [{ width: 1280, height: 720 }, '720p'],
    [{ width: 854, height: 480 }, '480p'],
    [{ width: 640, height: 360 }, '320p'],
    [{ width: 480, height: 320 }, '320p'],
    [{ width: 426, height: 240 }, 'SD'],
    [{ width: null, height: null }, null],
  ] as const)('labels %j as %s', (size, label) => {
    expect(resolutionLabel(size)).toBe(label)
  })
})

describe('splitResolution', () => {
  it.each([
    ['1080p', { resolution: '1080p', rest: '' }],
    ['4K HDR', { resolution: '4K', rest: 'HDR' }],
    ['1080p (HEVC) HDR', { resolution: '1080p', rest: '(HEVC) HDR' }],
    ['SD', { resolution: 'SD', rest: '' }],
    ['2h 58m', { resolution: null, rest: '2h 58m' }],
    ['4Kids', { resolution: null, rest: '4Kids' }],
    ['', { resolution: null, rest: '' }],
  ] as const)('splits %j', (fact, split) => {
    expect(splitResolution(fact)).toEqual(split)
  })
})
