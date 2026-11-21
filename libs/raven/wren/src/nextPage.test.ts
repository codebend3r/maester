import { describe, expect, it } from 'bun:test'
import type { Track } from '@raven/core'

import { tracksOfPages } from '@/nextPage'

type TrackForProps = { id: number; title: string }

const trackFor = ({ id, title }: TrackForProps): Track => ({
  id,
  libraryId: 1,
  albumId: 7,
  title,
  disc: 1,
  number: id,
  duration: 200,
  artists: [{ id: 3, name: 'Sia' }],
  container: 'flac',
  codec: 'flac',
  bitrate: null,
  sampleRate: null,
  bitDepth: null,
  isLossless: true,
  mbid: null,
  addedAt: '2026-11-01T00:00:00.000Z',
  album: { title: '1000 Forms Of Fear', coverVersion: null },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
})

const CHANDELIER = trackFor({ id: 1, title: 'Chandelier' })
const CELLOPHANE = trackFor({ id: 2, title: 'Cellophane' })
const HOSTAGE = trackFor({ id: 3, title: 'Hostage' })

describe('tracksOfPages', () => {
  it("puts every page's tracks in one list, in the pages' order", () => {
    const pages = [{ tracks: [CHANDELIER, CELLOPHANE] }, { tracks: [] }, { tracks: [HOSTAGE] }]
    expect(tracksOfPages(pages)).toEqual([CHANDELIER, CELLOPHANE, HOSTAGE])
  })

  it('is empty with no pages', () => {
    expect(tracksOfPages([])).toEqual([])
  })
})
