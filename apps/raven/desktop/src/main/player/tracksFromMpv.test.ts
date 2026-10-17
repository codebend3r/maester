import { expect, test } from 'bun:test'
import { MPV_TRACK_TYPES, type MpvTrack } from '@raven/mpv'
import { aidFor, sidFor, tracksFromMpv } from '@/main/player/tracksFromMpv'

const mpvTrack = (fields: Pick<MpvTrack, 'id' | 'type'> & Partial<MpvTrack>): MpvTrack => ({
  selected: undefined,
  default: undefined,
  external: undefined,
  forced: undefined,
  'hearing-impaired': undefined,
  lang: undefined,
  title: undefined,
  codec: undefined,
  'demux-channel-count': undefined,
  ...fields,
})

const list: MpvTrack[] = [
  mpvTrack({ id: 1, type: 'video', codec: 'hevc' }),
  mpvTrack({
    id: 1,
    type: 'audio',
    lang: 'eng',
    default: true,
    codec: 'truehd',
    'demux-channel-count': 8,
    title: 'Atmos',
  }),
  mpvTrack({ id: 2, type: 'audio', lang: 'fra', codec: 'ac3', 'demux-channel-count': 6 }),
  mpvTrack({ id: 1, type: 'sub', lang: 'eng', codec: 'hdmv_pgs_subtitle' }),
  mpvTrack({ id: 2, type: 'sub', lang: 'eng', codec: 'subrip', forced: true, default: true }),
  mpvTrack({ id: 3, type: 'sub', lang: 'spa', codec: 'subrip', external: true, title: 'Spanish' }),
]

test('audio tracks are numbered by position with mpv fields normalised', () => {
  const tracks = tracksFromMpv({ list, frameRate: 23.976 })
  expect(tracks.audio.map((track) => track.index)).toEqual([0, 1])
  expect(tracks.audio.map((track) => track.language)).toEqual(['en', 'fr'])
  expect(tracks.audio.map((track) => track.channels)).toEqual([8, 6])
  expect(tracks.audio[0]).toEqual({
    index: 0,
    codec: 'truehd',
    channels: 8,
    language: 'en',
    title: 'Atmos',
    default: true,
  })
  expect(tracks.audio[1]).toMatchObject({ title: null, default: false })
})

test('subtitles count embedded and external entries separately', () => {
  const tracks = tracksFromMpv({ list, frameRate: null })
  expect(tracks.subtitles.map((track) => track.id)).toEqual([
    'embedded-0',
    'embedded-1',
    'external-0',
  ])
  expect(tracks.subtitles.map((track) => track.source)).toEqual([
    'embedded',
    'embedded',
    'external',
  ])
  expect(tracks.subtitles.map((track) => track.forced)).toEqual([false, true, false])
  expect(tracks.subtitles.map((track) => track.hearingImpaired)).toEqual([false, false, false])
  expect(tracks.subtitles.map((track) => track.default)).toEqual([false, true, false])
  expect(tracks.subtitles.every((track) => track.supported)).toBe(true)
  expect(tracks.subtitles[2]).toEqual({
    id: 'external-0',
    source: 'external',
    codec: 'subrip',
    language: 'es',
    title: 'Spanish',
    default: false,
    forced: false,
    hearingImpaired: false,
    supported: true,
  })
})

test('hearing-impaired flags map to hearingImpaired', () => {
  const tracks = tracksFromMpv({
    list: [mpvTrack({ id: 1, type: 'sub', 'hearing-impaired': true })],
    frameRate: null,
  })
  expect(tracks.subtitles[0]).toMatchObject({ hearingImpaired: true })
})

test('defaultAudio is the flagged default, else the first, else null', () => {
  expect(tracksFromMpv({ list, frameRate: null }).defaultAudio).toBe(0)
  const flaggedSecond = list.map((track) =>
    track.type === MPV_TRACK_TYPES.audio ? { ...track, default: track.id === 2 } : track,
  )
  expect(tracksFromMpv({ list: flaggedSecond, frameRate: null }).defaultAudio).toBe(1)
  const unflagged = list.map((track) => ({ ...track, default: false }))
  expect(tracksFromMpv({ list: unflagged, frameRate: null }).defaultAudio).toBe(0)
  const noAudio = list.filter((track) => track.type !== MPV_TRACK_TYPES.audio)
  expect(tracksFromMpv({ list: noAudio, frameRate: null }).defaultAudio).toBeNull()
})

test('frameRate is kept only when above zero', () => {
  expect(tracksFromMpv({ list, frameRate: 23.976 }).frameRate).toBe(23.976)
  expect(tracksFromMpv({ list, frameRate: 0 }).frameRate).toBeNull()
  expect(tracksFromMpv({ list, frameRate: null }).frameRate).toBeNull()
})

test('aidFor returns the mpv id at a position', () => {
  expect(aidFor({ list, index: 1 })).toBe(2)
  expect(aidFor({ list, index: 0 })).toBe(1)
  expect(aidFor({ list, index: 5 })).toBeNull()
  expect(aidFor({ list, index: -1 })).toBeNull()
})

test('sidFor parses the track id and returns the mpv id', () => {
  expect(sidFor({ list, id: 'embedded-0' })).toBe(1)
  expect(sidFor({ list, id: 'embedded-1' })).toBe(2)
  expect(sidFor({ list, id: 'external-0' })).toBe(3)
  expect(sidFor({ list, id: 'external-1' })).toBeNull()
  expect(sidFor({ list, id: 'embedded-x' })).toBeNull()
  expect(sidFor({ list, id: 'pgs-0' })).toBeNull()
  expect(sidFor({ list, id: 'embedded-1 ' })).toBeNull()
})

test('an empty list has no tracks', () => {
  expect(tracksFromMpv({ list: [], frameRate: null })).toEqual({
    audio: [],
    subtitles: [],
    defaultAudio: null,
    frameRate: null,
  })
  expect(aidFor({ list: [], index: 0 })).toBeNull()
  expect(sidFor({ list: [], id: 'embedded-0' })).toBeNull()
})

test('a missing lang or title is null and an unknown language stays null', () => {
  const tracks = tracksFromMpv({
    list: [mpvTrack({ id: 1, type: 'audio' }), mpvTrack({ id: 1, type: 'sub' })],
    frameRate: null,
  })
  expect(tracks.audio[0]).toEqual({
    index: 0,
    codec: null,
    channels: null,
    language: null,
    title: null,
    default: false,
  })
  expect(tracks.subtitles[0]).toMatchObject({ language: null, title: null, codec: null })
})

test('a channel count of zero is unknown', () => {
  const tracks = tracksFromMpv({
    list: [mpvTrack({ id: 1, type: 'audio', 'demux-channel-count': 0 })],
    frameRate: null,
  })
  expect(tracks.audio[0]).toMatchObject({ channels: null })
})

test('a non-finite frame rate is unknown', () => {
  expect(tracksFromMpv({ list, frameRate: Number.POSITIVE_INFINITY }).frameRate).toBeNull()
  expect(tracksFromMpv({ list, frameRate: Number.NaN }).frameRate).toBeNull()
})

test('duplicate mpv ids are told apart by position and look up the first match', () => {
  const duplicated = [
    mpvTrack({ id: 1, type: 'audio' }),
    mpvTrack({ id: 1, type: 'audio' }),
    mpvTrack({ id: 1, type: 'sub' }),
    mpvTrack({ id: 1, type: 'sub', external: true }),
  ]
  const tracks = tracksFromMpv({ list: duplicated, frameRate: null })
  expect(tracks.audio.map((audio) => audio.index)).toEqual([0, 1])
  expect(tracks.subtitles.map((subtitle) => subtitle.id)).toEqual(['embedded-0', 'external-0'])
  expect(aidFor({ list: duplicated, index: 1 })).toBe(1)
})

test('an external entry listed before an embedded one keeps each source numbered on its own', () => {
  const mixed = [
    mpvTrack({ id: 4, type: 'sub', external: true }),
    mpvTrack({ id: 1, type: 'sub' }),
    mpvTrack({ id: 5, type: 'sub', external: true }),
    mpvTrack({ id: 2, type: 'sub' }),
  ]
  expect(tracksFromMpv({ list: mixed, frameRate: null }).subtitles.map((s) => s.id)).toEqual([
    'external-0',
    'embedded-0',
    'external-1',
    'embedded-1',
  ])
  expect(sidFor({ list: mixed, id: 'embedded-0' })).toBe(1)
  expect(sidFor({ list: mixed, id: 'embedded-1' })).toBe(2)
  expect(sidFor({ list: mixed, id: 'external-0' })).toBe(4)
  expect(sidFor({ list: mixed, id: 'external-1' })).toBe(5)
})

test('with several audio tracks flagged default the first wins', () => {
  const flagged = [
    mpvTrack({ id: 1, type: 'audio' }),
    mpvTrack({ id: 2, type: 'audio', default: true }),
    mpvTrack({ id: 3, type: 'audio', default: true }),
  ]
  expect(tracksFromMpv({ list: flagged, frameRate: null }).defaultAudio).toBe(1)
})
