import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { FIXTURE_SERVER, LIBRARY_KINDS } from '@raven/core'
import { wholeNumber } from '@shared/server'
import { runFixture } from '@/e2e/fixtureRun'
import { encodeClip, encodeRichClip, encodeTrack } from '@/test/clips'
import { fakeTmdb } from '@/test/fakeTmdb'

/**
 * A real raven server for the device app's and Wren's Maestro flows (`apps/raven/app/e2e`,
 * `apps/raven/music/e2e`): an open film library holding a movie, an open series library holding
 * two episodes and an open music library holding a three track FLAC album, with media tickets on. The movie and the first episode are MKVs, which an Apple
 * device plays through the server's HLS remux; the second episode is an MP4 with an English
 * sidecar, which it plays as it is. Both are matched against a fake TMDB, which knows no
 * MusicBrainz release, so the album keeps its tags and no request leaves the Mac. The music
 * library is neither pinned nor in the hero, so the device app's Home is as it was without it.
 * It listens on a fixed port (`runFixture`). The web's browser suite starts it on a port of its
 * own with the built web app's folder, which it then serves beside its API, as raven's image does.
 */
const FIXTURE = {
  movie: { folder: 'Kestrel Point (2024)', file: 'Kestrel Point (2024).mkv' },
  show: {
    folder: join('Lantern Bay', 'Season 1'),
    file: 'Lantern Bay - S01E01 - Low Tide.mkv',
    direct: 'Lantern Bay - S01E02 - High Water.mp4',
    sidecar: 'Lantern Bay - S01E02 - High Water.en.srt',
  },
  album: {
    folder: join(FIXTURE_SERVER.album.artist, FIXTURE_SERVER.album.title),
    tags: {
      album: FIXTURE_SERVER.album.title,
      album_artist: FIXTURE_SERVER.album.artist,
      artist: FIXTURE_SERVER.album.artist,
      date: '2024',
    },
    // Long enough that a flow reads the bar before the track ends and the next one starts.
    seconds: 20,
  },
} as const

const tmdb = fakeTmdb({
  movies: [{ id: 9001, title: FIXTURE_SERVER.movie.title, released: '2024-03-08' }],
  shows: [
    {
      id: 9002,
      title: FIXTURE_SERVER.show.title,
      first: '2024-01-05',
      seasons: {
        1: [
          { number: 1, title: FIXTURE_SERVER.show.episodes[0], aired: '2024-01-05' },
          { number: 2, title: FIXTURE_SERVER.show.episodes[1], aired: '2024-01-12' },
        ],
      },
    },
  ],
})

const CUES = ['1', '00:00:02,000 --> 00:00:05,000', 'The tide is turning.', ''].join('\n')

/** The sidecar's one cue lasts nearly all of the clip, so a player paused anywhere shows it. */
const SIDECAR_CUES = ['1', '00:00:01,000 --> 00:00:58,000', 'The water is rising.', ''].join('\n')

const fixtureWebDir = process.env[FIXTURE_SERVER.env.webDir]?.trim() ?? ''

await runFixture({
  name: 'fixture server',
  port: wholeNumber(process.env[FIXTURE_SERVER.env.port]) ?? FIXTURE_SERVER.appPort,
  webDir: fixtureWebDir === '' ? null : resolve(fixtureWebDir),
  metadataFetchFor: () => tmdb.fetch,
  prepare: async ({ media }) => {
    const movies = join(media, 'movies')
    const shows = join(media, 'shows')
    const music = join(media, 'music')
    const { album } = FIXTURE
    await Promise.all([
      ...FIXTURE_SERVER.album.tracks.map((title, index) =>
        encodeTrack({
          path: join(music, album.folder, `0${index + 1} ${title}.flac`),
          seconds: album.seconds,
          tags: { ...album.tags, title, track: String(index + 1) },
        }),
      ),
      encodeRichClip({
        path: join(movies, FIXTURE.movie.folder, FIXTURE.movie.file),
        seconds: 60,
        cues: CUES,
      }),
      encodeRichClip({ path: join(shows, FIXTURE.show.folder, FIXTURE.show.file), cues: CUES }),
      encodeClip({ path: join(shows, FIXTURE.show.folder, FIXTURE.show.direct), seconds: 60 }),
    ])
    await writeFile(join(shows, FIXTURE.show.folder, FIXTURE.show.sidecar), SIDECAR_CUES)
    return [
      {
        name: FIXTURE_SERVER.movie.library,
        paths: [movies],
        settings: { kind: LIBRARY_KINDS.movies },
      },
      {
        name: FIXTURE_SERVER.show.library,
        paths: [shows],
        settings: { kind: LIBRARY_KINDS.shows },
      },
      {
        name: FIXTURE_SERVER.album.library,
        paths: [music],
        settings: { kind: LIBRARY_KINDS.music, pinned: false, inHero: false },
      },
    ]
  },
})
