import { describe, expect, it } from 'bun:test'
import { PLAYED_KINDS, type PlayHistoryEntry, type Played } from '@/contract'
import { REACH_KINDS, historyGroups, reachOf } from '@/playHistory'

type EntryProps = { id: number; played: Played; accountId?: string }

const entry = ({ id, played, accountId = 'a' }: EntryProps): PlayHistoryEntry => ({
  id,
  accountId,
  mediaId: id,
  startedAt: '2026-11-04T12:00:00.000Z',
  lastPlayedAt: '2026-11-04T12:00:00.000Z',
  furthest: 10,
  duration: 200,
  libraryId: 1,
  libraryName: 'Music',
  played,
})

type TrackProps = { number: number; albumId?: number }

const track = ({ number, albumId = 7 }: TrackProps): Played => ({
  kind: PLAYED_KINDS.track,
  title: `Song ${number}`,
  artist: 'Radiohead',
  artists: [{ id: 3, name: 'Radiohead' }],
  album: albumId === 7 ? 'OK Computer' : 'Kid A',
  albumId,
  disc: 1,
  number,
  albumTracks: 3,
})

const film: Played = { kind: PLAYED_KINDS.video, title: 'Heat', year: 1995, itemId: 5 }

const shapeOf = (groups: ReturnType<typeof historyGroups>) =>
  groups.flatMap(({ run, entries }) => [
    ...(run
      ? [`album ${run.album} ${run.tracksHeard}/${run.albumTracks}${run.isWhole ? ' whole' : ''}`]
      : []),
    ...entries.map(({ id }) => `entry ${id}`),
  ])

describe('historyGroups', () => {
  it('heads a run of one album’s tracks, and says when the whole album was heard', () => {
    const rows = historyGroups([
      entry({ id: 5, played: track({ number: 3 }) }),
      entry({ id: 4, played: track({ number: 2 }) }),
      entry({ id: 3, played: track({ number: 1 }) }),
      entry({ id: 2, played: film }),
      entry({ id: 1, played: track({ number: 1 }) }),
    ])
    expect(shapeOf(rows)).toEqual([
      'album OK Computer 3/3 whole',
      'entry 5',
      'entry 4',
      'entry 3',
      'entry 2',
      'entry 1',
    ])
  })

  it('starts a new run for another album or another account', () => {
    const rows = historyGroups([
      entry({ id: 4, played: track({ number: 2 }) }),
      entry({ id: 3, played: track({ number: 1 }) }),
      entry({ id: 2, played: track({ number: 1, albumId: 8 }) }),
      entry({ id: 1, played: track({ number: 3 }), accountId: 'b' }),
    ])
    expect(shapeOf(rows)).toEqual([
      'album OK Computer 2/3',
      'entry 4',
      'entry 3',
      'entry 2',
      'entry 1',
    ])
  })

  it('counts a track heard twice once towards the album', () => {
    const rows = historyGroups([
      entry({ id: 2, played: track({ number: 1 }) }),
      entry({ id: 1, played: track({ number: 1 }) }),
    ])
    expect(shapeOf(rows)).toEqual(['album OK Computer 1/3', 'entry 2', 'entry 1'])
  })
})

describe('reachOf', () => {
  it('reads how far a sitting got', () => {
    expect(reachOf({ furthest: null, duration: 200 })).toEqual({ kind: REACH_KINDS.unknown })
    expect(reachOf({ furthest: 195, duration: 200 })).toEqual({ kind: REACH_KINDS.finished })
    expect(reachOf({ furthest: 1, duration: 200 })).toEqual({
      kind: REACH_KINDS.partial,
      furthest: 1,
      duration: 200,
      percent: 0,
    })
    expect(reachOf({ furthest: 30, duration: null })).toEqual({
      kind: REACH_KINDS.partial,
      furthest: 30,
      duration: null,
      percent: null,
    })
  })
})
