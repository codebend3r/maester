import { describe, expect, it } from 'vitest'
import { groupMedia } from '@/grouping'
import { mediaItem } from '@/test/fixtures'

const summary = (groups: ReturnType<typeof groupMedia>) =>
  groups.map((group) => [group.label, group.items.map((item) => item.id)])

describe('groupMedia', () => {
  it('buckets by resolution from 4K down, with unprobed videos last', () => {
    const items = [
      mediaItem({ id: 1, width: 1280, height: 720 }),
      mediaItem({ id: 2, width: null, height: null }),
      mediaItem({ id: 3, width: 3840, height: 2160 }),
      mediaItem({ id: 4, width: 1920, height: 800 }),
      mediaItem({ id: 5, width: 1920, height: 1080 }),
    ]
    expect(summary(groupMedia({ items, by: 'resolution' }))).toEqual([
      ['4K', [3]],
      ['1080p', [4, 5]],
      ['720p', [1]],
      ['Not probed yet', [2]],
    ])
  })

  it('buckets by codec, biggest bucket first, with unprobed videos last', () => {
    const items = [
      mediaItem({ id: 1, videoCodec: 'h264' }),
      mediaItem({ id: 2, videoCodec: null }),
      mediaItem({ id: 3, videoCodec: 'hevc' }),
      mediaItem({ id: 4, videoCodec: 'hevc' }),
      mediaItem({ id: 5, videoCodec: 'av1' }),
    ]
    expect(summary(groupMedia({ items, by: 'codec' }))).toEqual([
      ['HEVC', [3, 4]],
      ['AV1', [5]],
      ['H.264', [1]],
      ['Not probed yet', [2]],
    ])
  })

  it('buckets by the month a video was added, newest first', () => {
    const items = [
      mediaItem({ id: 1, addedAt: '2026-09-30T23:59:00.000Z' }),
      mediaItem({ id: 2, addedAt: '2026-10-01T00:01:00.000Z' }),
      mediaItem({ id: 3, addedAt: '2025-12-15T12:00:00.000Z' }),
      mediaItem({ id: 4, addedAt: '2026-10-09T08:00:00.000Z' }),
    ]
    expect(summary(groupMedia({ items, by: 'month' }))).toEqual([
      ['October 2026', [2, 4]],
      ['September 2026', [1]],
      ['December 2025', [3]],
    ])
  })
})
