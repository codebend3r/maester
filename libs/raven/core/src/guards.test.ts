import { describe, expect, it } from 'vitest'
import { isHistoryEntry, isLibrary, isMediaItem } from '@/guards'
import { library, mediaItem } from '@/test/fixtures'

describe('isMediaItem', () => {
  it('accepts an item that carries its favourite flag', () => {
    expect(isMediaItem(mediaItem({ favourite: true }))).toBe(true)
  })

  it('rejects an item whose favourite flag is missing', () => {
    const { favourite: _favourite, ...withoutFlag } = mediaItem()
    expect(isMediaItem(withoutFlag)).toBe(false)
  })
})

describe('isLibrary', () => {
  it('accepts a library that carries its settings', () => {
    expect(
      isLibrary(
        library({
          settings: {
            saveProgress: false,
            pinned: true,
            sort: 'random',
            view: 'tiles',
            groupBy: 'month',
            watchedPercent: 80,
          },
        }),
      ),
    ).toBe(true)
  })

  it('rejects a library whose watched percentage is out of range', () => {
    expect(isLibrary(library({ settings: { ...library().settings, watchedPercent: 150 } }))).toBe(
      false,
    )
  })

  it('rejects a library whose settings are missing', () => {
    const { settings: _settings, ...withoutSettings } = library()
    expect(isLibrary(withoutSettings)).toBe(false)
  })

  it('rejects a library with a setting that is not a boolean', () => {
    expect(isLibrary({ ...library(), settings: { ...library().settings, pinned: 'yes' } })).toBe(
      false,
    )
  })

  it('rejects a library whose view is not one of the choices', () => {
    expect(isLibrary({ ...library(), settings: { ...library().settings, view: 'poster' } })).toBe(
      false,
    )
  })
})

describe('isHistoryEntry', () => {
  it('accepts a video with when it was last played and how often', () => {
    expect(
      isHistoryEntry({
        media: mediaItem(),
        lastPlayedAt: '2026-10-10T19:00:00.000Z',
        plays: 2,
        furthest: 5000,
        watched: true,
      }),
    ).toBe(true)
  })

  it('rejects an entry that does not say whether it was watched', () => {
    expect(
      isHistoryEntry({
        media: mediaItem(),
        lastPlayedAt: '2026-10-10T19:00:00.000Z',
        plays: 2,
        furthest: 5000,
      }),
    ).toBe(false)
  })
})
