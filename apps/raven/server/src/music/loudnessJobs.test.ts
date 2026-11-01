import { LIBRARY_KINDS, type LibraryKind } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import type { AudioTags } from '@/music/audioReader'
import { REPLAYGAIN_SOURCES, albumGainOf, integratedOf } from '@/music/loudness'
import { LoudnessJobs } from '@/music/loudnessJobs'
import { MusicRepository } from '@/music/musicRepository'
import { testDatabase } from '@/test/database'
import { pictureVersionsOf } from '@/test/repositories'

const NO_GAIN: AudioTags['replayGain'] = {
  trackGain: null,
  trackPeak: null,
  albumGain: null,
  albumPeak: null,
}

const TAGS: AudioTags = {
  title: null,
  artists: ['Blur'],
  album: 'Parklife',
  albumArtists: ['Blur'],
  trackNumber: null,
  disc: null,
  year: null,
  releaseDate: null,
  originalYear: null,
  genres: [],
  isCompilation: false,
  label: null,
  isrc: null,
  recordingMbid: null,
  releaseMbid: null,
  releaseGroupMbid: null,
  artistMbids: [],
  albumArtistMbids: [],
  releaseTypes: [],
  replayGain: NO_GAIN,
  hasCover: false,
}

describe('LoudnessJobs', () => {
  const database = testDatabase('raven-loudness-jobs-')
  const jobs = () => new LoudnessJobs(database.get())
  const state = { music: 0, books: 0 }

  type AddProps = {
    libraryId: number
    kind: LibraryKind
    path: string
    duration: number
    album?: string
    replayGain?: AudioTags['replayGain']
  }

  const add = ({
    libraryId,
    kind,
    path,
    duration,
    album = 'Parklife',
    replayGain = NO_GAIN,
  }: AddProps): number => {
    const index = new MediaIndex(database.get())
    const id = index.insert({
      libraryId,
      kind,
      file: { path, root: '/', size: 1, mtimeMs: 1 },
    })
    index.saveProbe({
      id,
      probe: {
        duration,
        width: null,
        height: null,
        videoCodec: null,
        videoBitDepth: null,
        hdr: false,
        audioCodec: 'flac',
        audioChannels: 2,
        bitrate: 900000,
      },
      tracks: { audio: [], subtitles: [], defaultAudio: null, frameRate: null },
      chapters: [],
    })
    new MusicRepository(database.get(), pictureVersionsOf(database.get())).record({
      mediaId: id,
      libraryId,
      path,
      tags: { ...TAGS, album, replayGain },
      format: { sampleRate: 44100, bitDepth: 16, isLossless: true },
      folderCover: null,
    })
    return id
  }

  const albumIdOf = (mediaId: number): number =>
    database
      .get()
      .db.prepare<[number], { album_id: number }>('SELECT album_id FROM tracks WHERE media_id = ?')
      .get(mediaId)?.album_id ?? -1

  const albumSourceOf = (albumId: number): string | null =>
    database
      .get()
      .db.prepare<[number], { replaygain_source: string | null }>(
        'SELECT replaygain_source FROM albums WHERE id = ?',
      )
      .get(albumId)?.replaygain_source ?? null

  type AddToAlbumProps = { album: string; replayGain?: AudioTags['replayGain'] }

  /** Two tracks of `album` in the music library. */
  const addToAlbum = ({ album, replayGain }: AddToAlbumProps): number[] =>
    [1, 2].map((at) =>
      add({
        libraryId: state.music,
        kind: LIBRARY_KINDS.music,
        path: `/music/Blur/${album}/0${at}.flac`,
        duration: 120,
        album,
        replayGain,
      }),
    )

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    state.music = libraries.create({
      name: 'Music',
      paths: ['/music'],
      settings: { kind: LIBRARY_KINDS.music },
    }).id
    state.books = libraries.create({
      name: 'Books',
      paths: ['/books'],
      settings: { kind: LIBRARY_KINDS.audiobooks },
    }).id
  })

  afterAll(database.close)

  it('lists only a music library’s tracks whose tags give no gain', () => {
    const tagless = add({
      libraryId: state.music,
      kind: LIBRARY_KINDS.music,
      path: '/music/Blur/Parklife/01.flac',
      duration: 180,
    })
    add({
      libraryId: state.music,
      kind: LIBRARY_KINDS.music,
      path: '/music/Blur/Parklife/02.flac',
      duration: 60,
      replayGain: { ...NO_GAIN, trackGain: -4, trackPeak: 0.7 },
    })
    add({
      libraryId: state.books,
      kind: LIBRARY_KINDS.audiobooks,
      path: '/books/Book/01.mp3',
      duration: 3600,
    })
    const albumId = albumIdOf(tagless)
    expect(jobs().albumsDue()).toEqual([albumId])
    expect(
      jobs()
        .tracksDue(albumId)
        .map(({ mediaId }) => mediaId),
    ).toEqual([tagless])
  })

  it('gives the album a gain from its scanned and its tagged tracks, weighted by length', () => {
    const [albumId = -1] = jobs().albumsDue()
    const [track] = jobs().tracksDue(albumId)
    jobs().measured({ mediaId: track?.mediaId ?? -1, measured: { gain: -8, peak: 0.9 } })
    jobs().finishAlbum(albumId)
    expect(jobs().albumsDue()).toEqual([])
    const album = database
      .get()
      .db.prepare<
        [number],
        { replaygain_gain: number; replaygain_peak: number; replaygain_source: string }
      >('SELECT replaygain_gain, replaygain_peak, replaygain_source FROM albums WHERE id = ?')
      .get(albumId)
    expect(album).toMatchObject({
      replaygain_peak: 0.9,
      replaygain_source: REPLAYGAIN_SOURCES.scan,
    })
    expect(album?.replaygain_gain).toBeCloseTo(
      albumGainOf([
        { integrated: integratedOf(-8), duration: 180 },
        { integrated: integratedOf(-4), duration: 60 },
      ]),
      9,
    )
  })

  it('lists an album whose tracks all carry tag gains but which has no album tag, until it has a gain', () => {
    const [first = -1] = addToAlbum({
      album: 'Modern Life',
      replayGain: { ...NO_GAIN, trackGain: -6, trackPeak: 0.8 },
    })
    const albumId = albumIdOf(first)

    expect(jobs().albumsDue()).toContain(albumId)
    expect(jobs().tracksDue(albumId)).toEqual([])
    jobs().finishAlbum(albumId)
    expect(albumSourceOf(albumId)).toBe(REPLAYGAIN_SOURCES.scan)
    expect(jobs().albumsDue()).not.toContain(albumId)
  })

  it('lists an album whose tracks were all measured but whose scan stopped before its gain', () => {
    const tracks = addToAlbum({ album: 'Leisure' })
    const albumId = albumIdOf(tracks[0] ?? -1)
    tracks.forEach((mediaId) => jobs().measured({ mediaId, measured: { gain: -7, peak: 0.6 } }))

    expect(jobs().tracksDue(albumId)).toEqual([])
    expect(jobs().albumsDue()).toContain(albumId)
    jobs().finishAlbum(albumId)
    expect(jobs().albumsDue()).not.toContain(albumId)
  })

  it('leaves out an album none of whose tracks has a gain', () => {
    const tracks = addToAlbum({ album: 'The Great Escape' })
    const albumId = albumIdOf(tracks[0] ?? -1)
    tracks.forEach((mediaId) => jobs().failed(mediaId))

    expect(jobs().albumsDue()).not.toContain(albumId)
  })
})
