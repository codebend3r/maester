import { describe, expect, it } from 'bun:test'

import { FINISHED_SHOWN } from '@/library/libraryCounts'
import {
  SONG_NOTES,
  SONG_PROGRESS_KEPT,
  SONG_SAVE_EVERY_S,
  type SongProgress,
  finishedSongsOf,
  inProgressSongsOf,
  isSongSaveDue,
  mergedSongProgressOf,
  resumeAtOf,
  songAlbumIdsOf,
  songCountsOf,
  songLeftOf,
  songNoteOf,
  songStepOf,
  songProgressOf,
  withSongNote,
} from '@/library/songProgress'
import { AIRBAG, LUCKY, MUSIC, OK_COMPUTER, PARANOID } from '@/testing'

const SERVER = 'home'
const OTHER_SERVER = 'away'
const LIBRARIES = [MUSIC.id]

const timeOf = (minute: number) => `2026-11-26T10:${String(minute).padStart(2, '0')}:00.000Z`

type NoteProps = {
  songs: readonly SongProgress[]
  track: typeof AIRBAG
  position: number
  minute: number
}

const note = ({ songs, track, position, minute }: NoteProps) =>
  withSongNote({
    songs,
    serverId: SERVER,
    track,
    note: songNoteOf({ position, duration: track.duration }),
    at: timeOf(minute),
  })

describe('songNoteOf', () => {
  it('reads a song past 95% of its length as played to its end', () => {
    expect(songNoteOf({ position: 285, duration: 300 })).toEqual({ kind: SONG_NOTES.finished })
  })

  it('reads its first seconds as not begun, and 5% of a short song as the line', () => {
    expect(songNoteOf({ position: 4, duration: 300 })).toEqual({ kind: SONG_NOTES.notBegun })
    expect(songNoteOf({ position: 3, duration: 40 })).toEqual({
      kind: SONG_NOTES.partway,
      position: 3,
    })
  })

  it('reads the rest as partway, and a song of unknown length never as finished', () => {
    expect(songNoteOf({ position: 120, duration: 300 })).toEqual({
      kind: SONG_NOTES.partway,
      position: 120,
    })
    expect(songNoteOf({ position: 900, duration: null })).toEqual({
      kind: SONG_NOTES.partway,
      position: 900,
    })
  })
})

describe('isSongSaveDue', () => {
  it('is due once the song has moved the save step from the spot last saved, either way', () => {
    expect(isSongSaveDue({ lastSaved: 20, position: 20 + SONG_SAVE_EVERY_S })).toBe(true)
    expect(isSongSaveDue({ lastSaved: 60, position: 30 })).toBe(true)
    expect(isSongSaveDue({ lastSaved: 20, position: 25 })).toBe(false)
  })
})

describe('withSongNote', () => {
  it('keeps a song left partway with its spot, its album and its library', () => {
    expect(note({ songs: [], track: AIRBAG, position: 120, minute: 1 })).toEqual([
      {
        serverId: SERVER,
        trackId: AIRBAG.id,
        albumId: OK_COMPUTER.id,
        libraryId: MUSIC.id,
        left: { position: 120, at: timeOf(1) },
        finishedAt: null,
      },
    ])
  })

  it('leaves the songs as they were for a song not yet begun', () => {
    const songs = note({ songs: [], track: AIRBAG, position: 120, minute: 1 })
    expect(note({ songs, track: AIRBAG, position: 2, minute: 2 })).toEqual(songs)
  })

  it('finishes a song and takes it out of progress, and keeps it finished when begun again', () => {
    const partway = note({ songs: [], track: AIRBAG, position: 120, minute: 1 })
    const finished = note({ songs: partway, track: AIRBAG, position: 299, minute: 2 })
    expect(finished).toEqual([expect.objectContaining({ left: null, finishedAt: timeOf(2) })])
    const again = note({ songs: finished, track: AIRBAG, position: 60, minute: 3 })
    expect(again).toEqual([
      expect.objectContaining({ left: { position: 60, at: timeOf(3) }, finishedAt: timeOf(2) }),
    ])
  })

  it('keeps each song once, the most recently played first, at most as many as it keeps', () => {
    const songs = Array.from({ length: SONG_PROGRESS_KEPT }, (_, index) =>
      note({ songs: [], track: { ...AIRBAG, id: 1000 + index }, position: 60, minute: 1 }),
    ).flat()
    const noted = note({ songs, track: LUCKY, position: 60, minute: 9 })
    expect(noted).toHaveLength(SONG_PROGRESS_KEPT)
    expect(noted[0]?.trackId).toBe(LUCKY.id)
  })
})

describe('the lists', () => {
  const songs = [
    { track: AIRBAG, position: 120, minute: 1 },
    { track: PARANOID, position: 299, minute: 2 },
    { track: LUCKY, position: 60, minute: 3 },
    { track: AIRBAG, position: 299, minute: 4 },
    { track: AIRBAG, position: 100, minute: 5 },
  ].reduce<SongProgress[]>((kept, step) => note({ songs: kept, ...step }), [])
  const away = withSongNote({
    songs,
    serverId: OTHER_SERVER,
    track: PARANOID,
    note: { kind: SONG_NOTES.partway, position: 50 },
    at: timeOf(6),
  })

  it("lists the device's songs left partway, the most recently left first", () => {
    const listed = inProgressSongsOf({ songs: away, serverId: SERVER, libraryIds: LIBRARIES })
    expect(listed.map(({ trackId }) => trackId)).toEqual([AIRBAG.id, LUCKY.id])
  })

  it("lists the device's songs played to their end, the newest first", () => {
    const listed = finishedSongsOf({ songs: away, serverId: SERVER, libraryIds: LIBRARIES })
    expect(listed.map(({ trackId }) => trackId)).toEqual([AIRBAG.id, PARANOID.id])
  })

  it('keeps to the libraries worn', () => {
    expect(inProgressSongsOf({ songs, serverId: SERVER, libraryIds: [MUSIC.id + 1] })).toEqual([])
  })

  it('lists as many finished as Recently finished shows, and counts every one', () => {
    const many = Array.from({ length: FINISHED_SHOWN + 2 }, (_, index) => index).reduce<
      SongProgress[]
    >(
      (kept, index) =>
        withSongNote({
          songs: kept,
          serverId: SERVER,
          track: { ...AIRBAG, id: 2000 + index },
          note: { kind: SONG_NOTES.finished },
          at: timeOf(index % 60),
        }),
      [],
    )
    const props = { songs: many, serverId: SERVER, libraryIds: LIBRARIES }
    expect(finishedSongsOf(props)).toHaveLength(FINISHED_SHOWN)
    expect(songCountsOf(props)).toEqual({ inProgress: 0, finished: FINISHED_SHOWN + 2 })
  })

  it('names each album once', () => {
    expect(songAlbumIdsOf(songs)).toEqual([OK_COMPUTER.id])
  })

  it('resumes a song left partway from its spot, and no other', () => {
    expect(resumeAtOf({ songs: away, serverId: SERVER, trackId: AIRBAG.id })).toBe(100)
    expect(resumeAtOf({ songs: away, serverId: SERVER, trackId: PARANOID.id })).toBeNull()
    expect(resumeAtOf({ songs: away, serverId: OTHER_SERVER, trackId: PARANOID.id })).toBe(50)
  })
})

describe('songProgressOf', () => {
  it('keeps what reads back as a song, and drops the rest', () => {
    const songs = note({ songs: [], track: AIRBAG, position: 120, minute: 1 })
    expect(songProgressOf({ songs: [...songs, { trackId: 'Airbag' }, null] })).toEqual(songs)
    expect(songProgressOf(null)).toEqual([])
  })
})

describe('mergedSongProgressOf', () => {
  it('keeps what was noted meanwhile over the same song read back, and the rest of what was', () => {
    const saved = [
      ...note({ songs: [], track: AIRBAG, position: 60, minute: 1 }),
      ...note({ songs: [], track: LUCKY, position: 30, minute: 2 }),
    ]
    const current = note({ songs: [], track: AIRBAG, position: 200, minute: 3 })
    expect(mergedSongProgressOf({ current, saved: { songs: saved } })).toEqual([
      expect.objectContaining({
        trackId: AIRBAG.id,
        left: expect.objectContaining({ position: 200 }),
      }),
      expect.objectContaining({
        trackId: LUCKY.id,
        left: expect.objectContaining({ position: 30 }),
      }),
    ])
  })
})

/** One moment of the queue a test plays through `songStepOf`. */
type Moment = { track: typeof AIRBAG | null; position: number; isPlaying: boolean }

/** What a test's moments added up to: the song last heard, and each spot noted as `[id, position]`. */
type Played = { heard: ReturnType<typeof songStepOf>['heard']; saves: number[][] }

describe('songStepOf', () => {
  const play = (steps: readonly Moment[]) =>
    steps.reduce<Played>(
      ({ heard, saves }, step) => {
        const next = songStepOf({ heard, ...step })
        return {
          heard: next.heard,
          saves: [...saves, ...next.saves.map(({ track, position }) => [track.id, position])],
        }
      },
      { heard: null, saves: [] },
    )

  it('notes a song every save step of play and as it pauses', () => {
    const { saves } = play([
      { track: AIRBAG, position: 0, isPlaying: true },
      { track: AIRBAG, position: 6, isPlaying: true },
      { track: AIRBAG, position: SONG_SAVE_EVERY_S, isPlaying: true },
      { track: AIRBAG, position: 14, isPlaying: false },
    ])
    expect(saves).toEqual([
      [AIRBAG.id, SONG_SAVE_EVERY_S],
      [AIRBAG.id, 14],
    ])
  })

  it('notes its end once, and not again as it is left', () => {
    const { saves } = play([
      { track: AIRBAG, position: 280, isPlaying: true },
      { track: AIRBAG, position: 290, isPlaying: true },
      { track: AIRBAG, position: 299, isPlaying: true },
      { track: LUCKY, position: 0, isPlaying: true },
    ])
    expect(saves).toEqual([[AIRBAG.id, 290]])
  })

  it('notes where a song was left as another takes over or the queue empties', () => {
    const { saves, heard } = play([
      { track: AIRBAG, position: 0, isPlaying: true },
      { track: AIRBAG, position: 4, isPlaying: true },
      { track: LUCKY, position: 0, isPlaying: true },
      { track: LUCKY, position: 7, isPlaying: true },
      { track: null, position: 0, isPlaying: false },
    ])
    expect(saves).toEqual([
      [AIRBAG.id, 4],
      [LUCKY.id, 7],
    ])
    expect(heard).toBeNull()
  })

  it('notes its end again when it plays again under repeat one', () => {
    const { saves } = play([
      { track: AIRBAG, position: 280, isPlaying: true },
      { track: AIRBAG, position: 290, isPlaying: true },
      { track: AIRBAG, position: 0, isPlaying: true },
      { track: AIRBAG, position: 291, isPlaying: true },
    ])
    expect(saves).toEqual([
      [AIRBAG.id, 290],
      [AIRBAG.id, 0],
      [AIRBAG.id, 291],
    ])
  })

  it('leaves nothing for a song noted at its end, and its spot for one partway', () => {
    const partway = songStepOf({ heard: null, track: AIRBAG, position: 40, isPlaying: true })
    expect(songLeftOf(partway.heard)).toEqual([{ track: AIRBAG, position: 40 }])
    const ended = songStepOf({
      heard: partway.heard,
      track: AIRBAG,
      position: 299,
      isPlaying: true,
    })
    expect(songLeftOf(ended.heard)).toEqual([])
    expect(songLeftOf(null)).toEqual([])
  })
})
