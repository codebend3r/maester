import { describe, expect, it } from 'bun:test'
import {
  EMPTY_STATE,
  END_MARGIN_S,
  RECENTS_CAP,
  RESUME_CAP,
  TRACKS_CAP,
  addRecent,
  clearRecents,
  isPlayerState,
  removeRecent,
  resumeFor,
  savePosition,
  setTrackPick,
  setWindowBounds,
  trackPickFor,
  watchedShare,
  type FileFacts,
  type PlayerState,
} from '@/main/playerState'

const facts = (path: string, overrides: Partial<FileFacts> = {}): FileFacts => ({
  path,
  size: 1000,
  mtimeMs: 5000,
  ...overrides,
})

const distinct = (count: number): number[] => Array.from({ length: count }, (_, index) => index)

const withMany = (count: number, reduce: (state: PlayerState, index: number) => PlayerState) =>
  distinct(count).reduce(reduce, EMPTY_STATE)

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
    const state = addRecent(addRecent(EMPTY_STATE, { path: '/a.mkv', at: 1 }), {
      path: '/b.mkv',
      at: 2,
    })
    expect(state.recents.map((entry) => entry.path)).toEqual(['/b.mkv', '/a.mkv'])
    expect(state.recents[0]).toEqual({ kind: 'file', path: '/b.mkv', openedAt: 2 })
  })

  it('moves an existing path to the front without duplicating it', () => {
    const first = addRecent(EMPTY_STATE, { path: '/a.mkv', at: 1 })
    const second = addRecent(first, { path: '/b.mkv', at: 2 })
    const again = addRecent(second, { path: '/a.mkv', at: 3 })
    expect(again.recents.map((entry) => entry.path)).toEqual(['/a.mkv', '/b.mkv'])
    expect(again.recents[0]?.openedAt).toBe(3)
  })

  it('drops the oldest at the 51st distinct path', () => {
    const state = withMany(RECENTS_CAP + 1, (current, index) =>
      addRecent(current, { path: `/f${index}.mkv`, at: index }),
    )
    expect(state.recents.length).toBe(50)
    expect(state.recents.some((entry) => entry.path === '/f0.mkv')).toBe(false)
    expect(state.recents[0]?.path).toBe('/f50.mkv')
  })
})

describe('removeRecent and clearRecents', () => {
  it('removes one path and keeps the rest', () => {
    const state = addRecent(addRecent(EMPTY_STATE, { path: '/a', at: 1 }), { path: '/b', at: 2 })
    expect(removeRecent(state, { path: '/a' }).recents.map((entry) => entry.path)).toEqual(['/b'])
  })

  it('clears every recent but leaves the rest of the state', () => {
    const saved = savePosition(EMPTY_STATE, {
      file: facts('/a'),
      position: 40,
      duration: 120,
      at: 1,
    })
    const state = clearRecents(addRecent(saved, { path: '/a', at: 1 }))
    expect(state.recents).toEqual([])
    expect(state.resume.length).toBe(1)
  })
})

describe('savePosition', () => {
  it('stores the entry at 40 of 120', () => {
    const state = savePosition(EMPTY_STATE, {
      file: facts('/a'),
      position: 40,
      duration: 120,
      at: 7,
    })
    expect(state.resume).toEqual([
      { path: '/a', size: 1000, mtimeMs: 5000, position: 40, duration: 120, playedAt: 7 },
    ])
  })

  it('removes the entry at 115 of 120 (within the end margin)', () => {
    const saved = savePosition(EMPTY_STATE, {
      file: facts('/a'),
      position: 40,
      duration: 120,
      at: 1,
    })
    const state = savePosition(saved, { file: facts('/a'), position: 115, duration: 120, at: 2 })
    expect(state.resume).toEqual([])
  })

  it('keeps the entry just before the margin', () => {
    const state = savePosition(EMPTY_STATE, {
      file: facts('/a'),
      position: 109,
      duration: 120,
      at: 1,
    })
    expect(state.resume.length).toBe(1)
  })

  it('removes the entry at position 0', () => {
    const saved = savePosition(EMPTY_STATE, {
      file: facts('/a'),
      position: 40,
      duration: 120,
      at: 1,
    })
    const state = savePosition(saved, { file: facts('/a'), position: 0, duration: 120, at: 2 })
    expect(state.resume).toEqual([])
  })

  it('stores the entry when the duration is unknown', () => {
    const state = savePosition(EMPTY_STATE, {
      file: facts('/a'),
      position: 40,
      duration: null,
      at: 1,
    })
    expect(state.resume[0]?.duration).toBeNull()
    expect(state.resume.length).toBe(1)
  })

  it('replaces the entry for the same path and puts it first', () => {
    const one = savePosition(EMPTY_STATE, { file: facts('/a'), position: 10, duration: 120, at: 1 })
    const two = savePosition(one, { file: facts('/b'), position: 20, duration: 120, at: 2 })
    const three = savePosition(two, { file: facts('/a'), position: 30, duration: 120, at: 3 })
    expect(three.resume.map((entry) => entry.path)).toEqual(['/a', '/b'])
    expect(three.resume[0]?.position).toBe(30)
  })

  it('keeps 1,000 of 1,001 and drops the least recently played', () => {
    const state = withMany(RESUME_CAP + 1, (current, index) =>
      savePosition(current, {
        file: facts(`/f${index}`),
        position: 40,
        duration: 120,
        at: index,
      }),
    )
    expect(state.resume.length).toBe(1000)
    expect(state.resume.some((entry) => entry.path === '/f0')).toBe(false)
    expect(state.resume[0]?.path).toBe('/f1000')
  })
})

describe('resumeFor', () => {
  const saved = savePosition(EMPTY_STATE, {
    file: facts('/a'),
    position: 40,
    duration: 120,
    at: 1,
  })

  it('returns the position for matching facts', () => {
    expect(resumeFor(saved, { file: facts('/a') })).toBe(40)
  })

  it('returns 0 when the size differs', () => {
    expect(resumeFor(saved, { file: facts('/a', { size: 999 }) })).toBe(0)
  })

  it('returns 0 when the mtime differs (the replaced file)', () => {
    expect(resumeFor(saved, { file: facts('/a', { mtimeMs: 5001 }) })).toBe(0)
  })

  it('returns 0 for an unknown path', () => {
    expect(resumeFor(saved, { file: facts('/other') })).toBe(0)
  })

  it('returns 0 when the stored entry is within 10 s of its end', () => {
    const nearEnd: PlayerState = {
      ...saved,
      resume: [
        { path: '/a', size: 1000, mtimeMs: 5000, position: 115, duration: 120, playedAt: 1 },
      ],
    }
    expect(resumeFor(nearEnd, { file: facts('/a') })).toBe(0)
  })

  it('returns 0 for a stored position of 0 or less', () => {
    const zero: PlayerState = {
      ...saved,
      resume: [{ path: '/a', size: 1000, mtimeMs: 5000, position: 0, duration: 120, playedAt: 1 }],
    }
    expect(resumeFor(zero, { file: facts('/a') })).toBe(0)
  })

  it('returns the position when the duration is unknown', () => {
    const unknown = savePosition(EMPTY_STATE, {
      file: facts('/a'),
      position: 40,
      duration: null,
      at: 1,
    })
    expect(resumeFor(unknown, { file: facts('/a') })).toBe(40)
  })
})

describe('watchedShare', () => {
  it('is 0.5 for 60 of 120', () => {
    const state = savePosition(EMPTY_STATE, {
      file: facts('/a'),
      position: 60,
      duration: 120,
      at: 1,
    })
    expect(watchedShare(state, { path: '/a' })).toBe(0.5)
  })

  it('is null without a duration', () => {
    const state = savePosition(EMPTY_STATE, {
      file: facts('/a'),
      position: 60,
      duration: null,
      at: 1,
    })
    expect(watchedShare(state, { path: '/a' })).toBeNull()
  })

  it('is null for an unknown path', () => {
    expect(watchedShare(EMPTY_STATE, { path: '/nope' })).toBeNull()
  })

  it('is clamped to 0..1', () => {
    const over: PlayerState = {
      ...EMPTY_STATE,
      resume: [{ path: '/a', size: 1, mtimeMs: 1, position: 200, duration: 120, playedAt: 1 }],
    }
    expect(watchedShare(over, { path: '/a' })).toBe(1)
  })

  it('is null for a zero duration', () => {
    const zero: PlayerState = {
      ...EMPTY_STATE,
      resume: [{ path: '/a', size: 1, mtimeMs: 1, position: 0, duration: 0, playedAt: 1 }],
    }
    expect(watchedShare(zero, { path: '/a' })).toBeNull()
  })
})

describe('track picks', () => {
  it('stores a pick and reads it back', () => {
    const state = setTrackPick(EMPTY_STATE, { path: '/a', audio: 2, subtitle: 'en', at: 1 })
    expect(trackPickFor(state, { path: '/a' })).toEqual({ audio: 2, subtitle: 'en' })
  })

  it('returns null for an unknown path', () => {
    expect(trackPickFor(EMPTY_STATE, { path: '/a' })).toBeNull()
  })

  it('upserts newest first', () => {
    const one = setTrackPick(EMPTY_STATE, { path: '/a', audio: 1, subtitle: null, at: 1 })
    const two = setTrackPick(one, { path: '/b', audio: 1, subtitle: null, at: 2 })
    const three = setTrackPick(two, { path: '/a', audio: 3, subtitle: null, at: 3 })
    expect(three.tracks.map((pick) => pick.path)).toEqual(['/a', '/b'])
    expect(trackPickFor(three, { path: '/a' })?.audio).toBe(3)
  })

  it('keeps 1,000 of 1,001', () => {
    const state = withMany(TRACKS_CAP + 1, (current, index) =>
      setTrackPick(current, { path: `/f${index}`, audio: null, subtitle: null, at: index }),
    )
    expect(state.tracks.length).toBe(1000)
    expect(state.tracks.some((pick) => pick.path === '/f0')).toBe(false)
  })
})

describe('setWindowBounds', () => {
  it('stores the bounds', () => {
    const bounds = { x: 1, y: 2, width: 800, height: 600, displayId: 3 }
    expect(setWindowBounds(EMPTY_STATE, { bounds }).window).toEqual(bounds)
  })
})

describe('isPlayerState', () => {
  it('accepts EMPTY_STATE', () => {
    expect(isPlayerState(EMPTY_STATE)).toBe(true)
  })

  it('accepts a populated state after a JSON round trip', () => {
    const state = setWindowBounds(
      setTrackPick(
        savePosition(addRecent(EMPTY_STATE, { path: '/a', at: 1 }), {
          file: facts('/a'),
          position: 40,
          duration: null,
          at: 1,
        }),
        { path: '/a', audio: null, subtitle: null, at: 1 },
      ),
      { bounds: { x: 0, y: 0, width: 1, height: 1, displayId: 1 } },
    )
    expect(isPlayerState(JSON.parse(JSON.stringify(state)))).toBe(true)
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
    const base = savePosition(addRecent(EMPTY_STATE, { path: '/a', at: 1 }), {
      file: facts('/a'),
      position: 40,
      duration: 120,
      at: 1,
    })
    const withPick = setTrackPick(base, { path: '/a', audio: 1, subtitle: 'en', at: 1 })
    const reducers: Array<(state: PlayerState) => PlayerState> = [
      (state) => addRecent(state, { path: '/b', at: 2 }),
      (state) => addRecent(state, { path: '/a', at: 2 }),
      (state) => removeRecent(state, { path: '/a' }),
      (state) => clearRecents(state),
      (state) => savePosition(state, { file: facts('/a'), position: 50, duration: 120, at: 2 }),
      (state) => savePosition(state, { file: facts('/a'), position: 0, duration: 120, at: 2 }),
      (state) => setTrackPick(state, { path: '/a', audio: 2, subtitle: null, at: 2 }),
      (state) =>
        setWindowBounds(state, { bounds: { x: 1, y: 1, width: 1, height: 1, displayId: 1 } }),
    ]
    reducers.forEach((reduce) => {
      const before = structuredClone(withPick)
      reduce(withPick)
      expect(withPick).toEqual(before)
    })
  })
})
