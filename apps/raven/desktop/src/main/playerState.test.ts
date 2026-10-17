import { describe, expect, it } from 'bun:test'
import {
  EMPTY_STATE,
  END_MARGIN_S,
  forgetResume,
  RECENTS_CAP,
  RESUME_CAP,
  TRACKS_CAP,
  addRecent,
  clearRecents,
  isPlayerState,
  noteServerRecent,
  RECENT_KINDS,
  RECENT_LABEL_MAX,
  recentKey,
  removeRecent,
  removeRecentByKey,
  removeServerRecents,
  resumeFor,
  savePosition,
  setTrackPick,
  setWindowBounds,
  trackPickFor,
  watchedShare,
  type FileFacts,
  type PlayerState,
} from '@/main/playerState'

const facts = ({ path, ...overrides }: { path: string } & Partial<FileFacts>): FileFacts => ({
  path,
  size: 1000,
  mtimeMs: 5000,
  ...overrides,
})

const distinct = (count: number): number[] => Array.from({ length: count }, (_, index) => index)

const withMany = ({
  count,
  reduce,
}: {
  count: number
  reduce: (state: PlayerState, index: number) => PlayerState
}) => distinct(count).reduce(reduce, EMPTY_STATE)

describe('constants', () => {
  it('pins the caps and the end margin', () => {
    expect(RECENTS_CAP).toBe(50)
    expect(RESUME_CAP).toBe(1000)
    expect(TRACKS_CAP).toBe(1000)
    expect(END_MARGIN_S).toBe(10)
  })
})

describe('addRecent', () => {
  it('puts the newest first', () => {
    const state = addRecent({
      state: addRecent({ state: EMPTY_STATE, path: '/a.mkv', at: 1 }),
      path: '/b.mkv',
      at: 2,
    })
    expect(state.recents.map(recentKey)).toEqual(['file:/b.mkv', 'file:/a.mkv'])
    expect(state.recents[0]).toEqual({ kind: 'file', path: '/b.mkv', openedAt: 2 })
  })

  it('moves an existing path to the front without duplicating it', () => {
    const first = addRecent({ state: EMPTY_STATE, path: '/a.mkv', at: 1 })
    const second = addRecent({ state: first, path: '/b.mkv', at: 2 })
    const again = addRecent({ state: second, path: '/a.mkv', at: 3 })
    expect(again.recents.map(recentKey)).toEqual(['file:/a.mkv', 'file:/b.mkv'])
    expect(again.recents[0]!.openedAt).toBe(3)
  })

  it('drops the oldest at the 51st distinct path', () => {
    const state = withMany({
      count: RECENTS_CAP + 1,
      reduce: (current, index) => addRecent({ state: current, path: `/f${index}.mkv`, at: index }),
    })
    expect(state.recents.length).toBe(50)
    expect(state.recents.some((entry) => recentKey(entry) === 'file:/f0.mkv')).toBe(false)
    expect(recentKey(state.recents[0]!)).toBe('file:/f50.mkv')
  })
})

describe('removeRecent and clearRecents', () => {
  it('removes one path and keeps the rest', () => {
    const state = addRecent({
      state: addRecent({ state: EMPTY_STATE, path: '/a', at: 1 }),
      path: '/b',
      at: 2,
    })
    expect(removeRecent({ state, path: '/a' }).recents.map(recentKey)).toEqual(['file:/b'])
  })

  it('clears every recent but leaves the rest of the state', () => {
    const saved = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 40,
      duration: 120,
      at: 1,
    })
    const state = clearRecents(addRecent({ state: saved, path: '/a', at: 1 }))
    expect(state.recents).toEqual([])
    expect(state.resume.length).toBe(1)
  })
})

const SERVER = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER_SERVER = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

const noteDune = ({
  state,
  label = 'Dune',
  watched = 0.25,
  at,
}: {
  state: PlayerState
  label?: string
  watched?: number | null
  at: number
}): PlayerState => noteServerRecent({ state, serverId: SERVER, mediaId: 7, label, watched, at })

describe('server recents', () => {
  const labelOf = ({ label }: { label: string }): string => {
    const [entry] = noteDune({ state: EMPTY_STATE, label, at: 1 }).recents
    return entry?.kind === RECENT_KINDS.server ? entry.label : ''
  }

  it('collapses whitespace and trims a label', () => {
    expect(labelOf({ label: '  Dune:\t Part\n Two  ' })).toBe('Dune: Part Two')
  })

  it('drops control and format characters from a label, bidi overrides and zero widths too', () => {
    expect(labelOf({ label: 'Du\u202ene\u200b\u0007 2' })).toBe('Dune 2')
  })

  it('keeps the joiners a Persian title and an emoji need, and drops the rest', () => {
    const persian = '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645'
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'
    expect(labelOf({ label: `${persian}\u202e ${family}\u200b` })).toBe(`${persian} ${family}`)
  })

  it('cuts a label of 201 code points to the first 200', () => {
    expect(labelOf({ label: 'a'.repeat(RECENT_LABEL_MAX + 1) })).toBe('a'.repeat(RECENT_LABEL_MAX))
    expect(RECENT_LABEL_MAX).toBe(200)
  })

  it('never splits a surrogate pair at the cut', () => {
    const label = `${'a'.repeat(RECENT_LABEL_MAX - 1)}\u{1F985}b`
    expect(labelOf({ label })).toBe(`${'a'.repeat(RECENT_LABEL_MAX - 1)}\u{1F985}`)
  })

  it('keys a file by its path and a server title by its server and media ids', () => {
    expect(recentKey({ kind: 'file', path: '/m/a.mkv', openedAt: 1 })).toBe('file:/m/a.mkv')
    expect(
      recentKey({
        kind: 'server',
        serverId: SERVER,
        mediaId: 7,
        label: 'Dune',
        watched: null,
        openedAt: 1,
      }),
    ).toBe(`server:${SERVER}:7`)
  })

  it('keeps one entry per title, newest first, with the latest label and share', () => {
    const first = noteDune({ state: EMPTY_STATE, at: 1 })
    const between = addRecent({ state: first, path: '/a.mkv', at: 2 })
    const state = noteDune({ state: between, label: 'Dune: Part One', watched: 0.5, at: 3 })
    expect(state.recents).toEqual([
      {
        kind: 'server',
        serverId: SERVER,
        mediaId: 7,
        label: 'Dune: Part One',
        watched: 0.5,
        openedAt: 3,
      },
      { kind: 'file', path: '/a.mkv', openedAt: 2 },
    ])
  })

  it('tells a server title apart from another server and another title', () => {
    const state = [
      { serverId: SERVER, mediaId: 7 },
      { serverId: OTHER_SERVER, mediaId: 7 },
      { serverId: SERVER, mediaId: 8 },
    ].reduce(
      (current, { serverId, mediaId }, index) =>
        noteServerRecent({
          state: current,
          serverId,
          mediaId,
          label: 'x',
          watched: null,
          at: index,
        }),
      EMPTY_STATE,
    )
    expect(state.recents).toHaveLength(3)
  })

  it('shares the cap of 50 with the files', () => {
    const files = withMany({
      count: RECENTS_CAP - 1,
      reduce: (current, index) => addRecent({ state: current, path: `/f${index}.mkv`, at: index }),
    })
    const state = addRecent({
      state: noteDune({ state: files, at: 100 }),
      path: '/last.mkv',
      at: 101,
    })
    expect(state.recents).toHaveLength(RECENTS_CAP)
    expect(state.recents.map(recentKey).slice(0, 2)).toEqual([
      'file:/last.mkv',
      `server:${SERVER}:7`,
    ])
    expect(state.recents.some((entry) => recentKey(entry) === 'file:/f0.mkv')).toBe(false)
  })

  it('removes one entry by its key, whichever kind it is', () => {
    const state = addRecent({
      state: noteDune({ state: EMPTY_STATE, at: 1 }),
      path: '/a.mkv',
      at: 2,
    })
    expect(removeRecentByKey({ state, key: `server:${SERVER}:7` }).recents.map(recentKey)).toEqual([
      'file:/a.mkv',
    ])
    expect(removeRecentByKey({ state, key: 'file:/a.mkv' }).recents.map(recentKey)).toEqual([
      `server:${SERVER}:7`,
    ])
  })

  it("drops only the removed server's titles", () => {
    const state = [
      (current: PlayerState) => noteDune({ state: current, at: 1 }),
      (current: PlayerState) => addRecent({ state: current, path: '/a.mkv', at: 2 }),
      (current: PlayerState) =>
        noteServerRecent({
          state: current,
          serverId: OTHER_SERVER,
          mediaId: 7,
          label: 'Dune',
          watched: null,
          at: 3,
        }),
      (current: PlayerState) =>
        noteServerRecent({
          state: current,
          serverId: SERVER,
          mediaId: 9,
          label: 'Arrival',
          watched: null,
          at: 4,
        }),
    ].reduce((current, step) => step(current), EMPTY_STATE)
    expect(removeServerRecents({ state, serverId: SERVER }).recents.map(recentKey)).toEqual([
      `server:${OTHER_SERVER}:7`,
      'file:/a.mkv',
    ])
  })

  it('clears both kinds', () => {
    const state = addRecent({
      state: noteDune({ state: EMPTY_STATE, at: 1 }),
      path: '/a.mkv',
      at: 2,
    })
    expect(clearRecents(state).recents).toEqual([])
  })
})

describe('savePosition', () => {
  it('stores the entry at 40 of 120', () => {
    const state = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 40,
      duration: 120,
      at: 7,
    })
    expect(state.resume).toEqual([
      { path: '/a', size: 1000, mtimeMs: 5000, position: 40, duration: 120, playedAt: 7 },
    ])
  })

  it('removes the entry at 115 of 120 (within the end margin)', () => {
    const saved = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 40,
      duration: 120,
      at: 1,
    })
    const state = savePosition({
      state: saved,
      file: facts({ path: '/a' }),
      position: 115,
      duration: 120,
      at: 2,
    })
    expect(state.resume).toEqual([])
  })

  it('keeps the entry just before the margin', () => {
    const state = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 109,
      duration: 120,
      at: 1,
    })
    expect(state.resume.length).toBe(1)
  })

  it('removes the entry at position 0', () => {
    const saved = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 40,
      duration: 120,
      at: 1,
    })
    const state = savePosition({
      state: saved,
      file: facts({ path: '/a' }),
      position: 0,
      duration: 120,
      at: 2,
    })
    expect(state.resume).toEqual([])
  })

  it('stores the entry when the duration is unknown', () => {
    const state = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 40,
      duration: null,
      at: 1,
    })
    expect(state.resume[0]!.duration).toBeNull()
    expect(state.resume.length).toBe(1)
  })

  it('keeps the stored duration when a save arrives without one', () => {
    const saved = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 40,
      duration: 120,
      at: 1,
    })
    const state = savePosition({
      state: saved,
      file: facts({ path: '/a' }),
      position: 40,
      duration: null,
      at: 2,
    })
    expect(state.resume[0]!.duration).toBe(120)
    expect(watchedShare({ state, file: facts({ path: '/a' }) })).toBeCloseTo(0.33, 2)
  })

  it('treats a duration-less save near the stored end as finished', () => {
    const saved = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 40,
      duration: 120,
      at: 1,
    })
    const state = savePosition({
      state: saved,
      file: facts({ path: '/a' }),
      position: 115,
      duration: null,
      at: 2,
    })
    expect(state.resume).toEqual([])
  })

  it('drops the stored duration of a replaced file', () => {
    const saved = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 40,
      duration: 120,
      at: 1,
    })
    const state = savePosition({
      state: saved,
      file: facts({ path: '/a', size: 2000 }),
      position: 40,
      duration: null,
      at: 2,
    })
    expect(state.resume[0]!.duration).toBeNull()
  })

  it('replaces the entry for the same path and puts it first', () => {
    const one = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 10,
      duration: 120,
      at: 1,
    })
    const two = savePosition({
      state: one,
      file: facts({ path: '/b' }),
      position: 20,
      duration: 120,
      at: 2,
    })
    const three = savePosition({
      state: two,
      file: facts({ path: '/a' }),
      position: 30,
      duration: 120,
      at: 3,
    })
    expect(three.resume.map((entry) => entry.path)).toEqual(['/a', '/b'])
    expect(three.resume[0]!.position).toBe(30)
  })

  it('keeps 1,000 of 1,001 and drops the least recently played', () => {
    const state = withMany({
      count: RESUME_CAP + 1,
      reduce: (current, index) =>
        savePosition({
          state: current,
          file: facts({ path: `/f${index}` }),
          position: 40,
          duration: 120,
          at: index,
        }),
    })
    expect(state.resume.length).toBe(1000)
    expect(state.resume.some((entry) => entry.path === '/f0')).toBe(false)
    expect(state.resume[0]!.path).toBe('/f1000')
  })
})

describe('resumeFor', () => {
  const saved = savePosition({
    state: EMPTY_STATE,
    file: facts({ path: '/a' }),
    position: 40,
    duration: 120,
    at: 1,
  })

  it('returns the position for matching facts', () => {
    expect(resumeFor({ state: saved, file: facts({ path: '/a' }) })).toBe(40)
  })

  it('returns 0 when the size differs', () => {
    expect(resumeFor({ state: saved, file: facts({ path: '/a', size: 999 }) })).toBe(0)
  })

  it('returns 0 when the mtime differs (the replaced file)', () => {
    expect(resumeFor({ state: saved, file: facts({ path: '/a', mtimeMs: 5001 }) })).toBe(0)
  })

  it('returns 0 for an unknown path', () => {
    expect(resumeFor({ state: saved, file: facts({ path: '/other' }) })).toBe(0)
  })

  it('returns 0 when the stored entry is within 10 s of its end', () => {
    const nearEnd: PlayerState = {
      ...saved,
      resume: [
        { path: '/a', size: 1000, mtimeMs: 5000, position: 115, duration: 120, playedAt: 1 },
      ],
    }
    expect(resumeFor({ state: nearEnd, file: facts({ path: '/a' }) })).toBe(0)
  })

  it('returns 0 for a stored position of 0 or less', () => {
    const zero: PlayerState = {
      ...saved,
      resume: [{ path: '/a', size: 1000, mtimeMs: 5000, position: 0, duration: 120, playedAt: 1 }],
    }
    expect(resumeFor({ state: zero, file: facts({ path: '/a' }) })).toBe(0)
  })

  it('returns the position when the duration is unknown', () => {
    const unknown = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 40,
      duration: null,
      at: 1,
    })
    expect(resumeFor({ state: unknown, file: facts({ path: '/a' }) })).toBe(40)
  })
})

describe('forgetResume', () => {
  const saved = [facts({ path: '/a' }), facts({ path: '/b' })].reduce(
    (state, file) => savePosition({ state, file, position: 40, duration: 120, at: 1 }),
    addRecent({ state: EMPTY_STATE, path: '/a', at: 1 }),
  )

  it("drops the path's resume spot and keeps the others and the recents", () => {
    const forgotten = forgetResume({ state: saved, path: '/a' })
    expect(forgotten.resume.map((entry) => entry.path)).toEqual(['/b'])
    expect(resumeFor({ state: forgotten, file: facts({ path: '/a' }) })).toBe(0)
    expect(forgotten.recents).toEqual(saved.recents)
  })

  it('hands back the same state when the path has no spot, so nothing is written', () => {
    expect(forgetResume({ state: saved, path: '/other' })).toBe(saved)
  })
})

describe('watchedShare', () => {
  it('is 0.5 for 60 of 120', () => {
    const state = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 60,
      duration: 120,
      at: 1,
    })
    expect(watchedShare({ state, file: facts({ path: '/a' }) })).toBe(0.5)
  })

  it('is null without a duration', () => {
    const state = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 60,
      duration: null,
      at: 1,
    })
    expect(watchedShare({ state, file: facts({ path: '/a' }) })).toBeNull()
  })

  it('is null when the file was replaced since, as resumeFor starts it at 0', () => {
    const state = savePosition({
      state: EMPTY_STATE,
      file: facts({ path: '/a' }),
      position: 60,
      duration: 120,
      at: 1,
    })
    const replaced = facts({ path: '/a', size: 2000 })
    expect(resumeFor({ state, file: replaced })).toBe(0)
    expect(watchedShare({ state, file: replaced })).toBeNull()
    expect(watchedShare({ state, file: facts({ path: '/a', mtimeMs: 9000 }) })).toBeNull()
  })

  it('is null for an unknown path', () => {
    expect(watchedShare({ state: EMPTY_STATE, file: facts({ path: '/nope' }) })).toBeNull()
  })

  it('is clamped to 0..1', () => {
    const over: PlayerState = {
      ...EMPTY_STATE,
      resume: [{ path: '/a', size: 1, mtimeMs: 1, position: 200, duration: 120, playedAt: 1 }],
    }
    expect(watchedShare({ state: over, file: facts({ path: '/a', size: 1, mtimeMs: 1 }) })).toBe(1)
  })

  it('is null for a zero duration', () => {
    const zero: PlayerState = {
      ...EMPTY_STATE,
      resume: [{ path: '/a', size: 1, mtimeMs: 1, position: 0, duration: 0, playedAt: 1 }],
    }
    expect(
      watchedShare({ state: zero, file: facts({ path: '/a', size: 1, mtimeMs: 1 }) }),
    ).toBeNull()
  })
})

describe('track picks', () => {
  it('stores a pick and reads it back', () => {
    const state = setTrackPick({ state: EMPTY_STATE, path: '/a', audio: 2, subtitle: 'en', at: 1 })
    expect(trackPickFor({ state, path: '/a' })).toEqual({ audio: 2, subtitle: 'en' })
  })

  it('returns null for an unknown path', () => {
    expect(trackPickFor({ state: EMPTY_STATE, path: '/a' })).toBeNull()
  })

  it('upserts newest first', () => {
    const one = setTrackPick({ state: EMPTY_STATE, path: '/a', audio: 1, subtitle: null, at: 1 })
    const two = setTrackPick({ state: one, path: '/b', audio: 1, subtitle: null, at: 2 })
    const three = setTrackPick({ state: two, path: '/a', audio: 3, subtitle: null, at: 3 })
    expect(three.tracks.map((pick) => pick.path)).toEqual(['/a', '/b'])
    expect(trackPickFor({ state: three, path: '/a' })!.audio).toBe(3)
  })

  it('keeps 1,000 of 1,001', () => {
    const state = withMany({
      count: TRACKS_CAP + 1,
      reduce: (current, index) =>
        setTrackPick({
          state: current,
          path: `/f${index}`,
          audio: null,
          subtitle: null,
          at: index,
        }),
    })
    expect(state.tracks.length).toBe(1000)
    expect(state.tracks.some((pick) => pick.path === '/f0')).toBe(false)
  })
})

describe('setWindowBounds', () => {
  it('stores the bounds', () => {
    const bounds = { x: 1, y: 2, width: 800, height: 600, displayId: 3 }
    expect(setWindowBounds({ state: EMPTY_STATE, bounds }).window).toEqual(bounds)
  })
})

describe('isPlayerState', () => {
  it('accepts EMPTY_STATE', () => {
    expect(isPlayerState(EMPTY_STATE)).toBe(true)
  })

  it('accepts a populated state after a JSON round trip', () => {
    const state = setWindowBounds({
      state: setTrackPick({
        state: savePosition({
          state: addRecent({ state: EMPTY_STATE, path: '/a', at: 1 }),
          file: facts({ path: '/a' }),
          position: 40,
          duration: null,
          at: 1,
        }),
        path: '/a',
        audio: null,
        subtitle: null,
        at: 1,
      }),
      bounds: { x: 0, y: 0, width: 1, height: 1, displayId: 1 },
    })
    expect(isPlayerState(JSON.parse(JSON.stringify(state)))).toBe(true)
  })

  it('accepts a version 1 file written before server titles, holding only file recents', () => {
    const written = {
      version: 1,
      recents: [
        { kind: 'file', path: '/m/a.mkv', openedAt: 2 },
        { kind: 'file', path: '/m/b.mkv', openedAt: 1 },
      ],
      resume: [],
      tracks: [],
      window: null,
    }
    expect(isPlayerState(JSON.parse(JSON.stringify(written)))).toBe(true)
  })

  it('accepts server recents after a JSON round trip and rejects a malformed one', () => {
    const state = noteDune({ state: EMPTY_STATE, at: 1 })
    expect(isPlayerState(JSON.parse(JSON.stringify(state)))).toBe(true)
    const [entry] = state.recents
    expect(isPlayerState({ ...state, recents: [{ ...entry, serverId: 'raven.example' }] })).toBe(
      false,
    )
    expect(isPlayerState({ ...state, recents: [{ ...entry, mediaId: 0 }] })).toBe(false)
    expect(isPlayerState({ ...state, recents: [{ ...entry, watched: '0.5' }] })).toBe(false)
  })

  it('rejects another version', () => {
    expect(isPlayerState({ ...EMPTY_STATE, version: 2 })).toBe(false)
  })

  it('rejects recents that are not a list', () => {
    expect(isPlayerState({ ...EMPTY_STATE, recents: 'x' })).toBe(false)
  })

  it('rejects a malformed entry', () => {
    expect(isPlayerState({ ...EMPTY_STATE, resume: [{ path: '/a' }] })).toBe(false)
  })
})

describe('purity', () => {
  it('no reducer mutates its input', () => {
    const base = savePosition({
      state: addRecent({ state: EMPTY_STATE, path: '/a', at: 1 }),
      file: facts({ path: '/a' }),
      position: 40,
      duration: 120,
      at: 1,
    })
    const withPick = noteDune({
      state: setTrackPick({ state: base, path: '/a', audio: 1, subtitle: 'en', at: 1 }),
      at: 1,
    })
    const reducers: Array<(state: PlayerState) => PlayerState> = [
      (state) => addRecent({ state, path: '/b', at: 2 }),
      (state) => addRecent({ state, path: '/a', at: 2 }),
      (state) => removeRecent({ state, path: '/a' }),
      (state) => noteDune({ state, at: 2 }),
      (state) => removeRecentByKey({ state, key: 'file:/a' }),
      (state) => removeServerRecents({ state, serverId: SERVER }),
      (state) => clearRecents(state),
      (state) =>
        savePosition({ state, file: facts({ path: '/a' }), position: 50, duration: 120, at: 2 }),
      (state) =>
        savePosition({ state, file: facts({ path: '/a' }), position: 0, duration: 120, at: 2 }),
      (state) => setTrackPick({ state, path: '/a', audio: 2, subtitle: null, at: 2 }),
      (state) =>
        setWindowBounds({ state, bounds: { x: 1, y: 1, width: 1, height: 1, displayId: 1 } }),
    ]
    reducers.forEach((reduce) => {
      const before = structuredClone(withPick)
      reduce(withPick)
      expect(withPick).toEqual(before)
    })
  })
})
