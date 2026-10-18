import { describe, expect, it } from 'bun:test'
import { sidecarTracksOf } from '@/main/servers/sidecarTracks'
import { subtitleTrack, tracksWith } from '@/main/test/downloadFakes'

describe('sidecarTracksOf', () => {
  it("keeps only the server's own subtitle files, named external-<n>", () => {
    const kept = subtitleTrack({ id: 'external-0' })
    const later = subtitleTrack({ id: 'external-12', title: null, language: null })
    expect(
      sidecarTracksOf(
        tracksWith([
          kept,
          subtitleTrack({ id: 'embedded-1', source: 'embedded' }),
          subtitleTrack({ id: 'external-1', source: 'embedded' }),
          subtitleTrack({ id: 'external-../x' }),
          later,
        ]),
      ),
    ).toEqual([kept, later])
  })
})
