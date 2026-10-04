import { describe, expect, it } from 'vitest'
import { containerOf, isVideoFile, resolutionLabel, titleFromFileName } from './media.js'

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
    [{ width: 3840, height: 2160 }, '4K'],
    [{ width: 3840, height: 1600 }, '4K'],
    [{ width: 1920, height: 800 }, '1080p'],
    [{ width: 1280, height: 720 }, '720p'],
    [{ width: 854, height: 480 }, '480p'],
    [{ width: 640, height: 360 }, 'SD'],
    [{ width: null, height: null }, null],
  ])('labels %j as %s', (size, label) => {
    expect(resolutionLabel(size)).toBe(label)
  })
})
