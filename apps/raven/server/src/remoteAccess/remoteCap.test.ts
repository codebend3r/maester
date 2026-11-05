import { PLAYBACK_MODES, REMOTE_LIMITS, STREAM_QUALITIES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { sizeForNetwork } from '@/remoteAccess/remoteCap'

const asked = { key: 'high1080', size: STREAM_QUALITIES.high1080 } as const
const limited = { remoteLimit: 'low720', uploadMbps: null } as const

describe('sizeForNetwork', () => {
  it('lowers a remote transcode to the limit', () => {
    expect(
      sizeForNetwork({
        sized: asked,
        mode: PLAYBACK_MODES.transcode,
        isLan: false,
        remote: limited,
        defaultBitrate: 8_000_000,
      }),
    ).toEqual({ key: 'low720', size: STREAM_QUALITIES.low720 })
  })

  it("holds the server's own settings to the limit when they aim higher", () => {
    expect(
      sizeForNetwork({
        sized: null,
        mode: PLAYBACK_MODES.transcode,
        isLan: false,
        remote: limited,
        defaultBitrate: 8_000_000,
      }),
    ).toEqual({ key: 'low720', size: STREAM_QUALITIES.low720 })
    expect(
      sizeForNetwork({
        sized: null,
        mode: PLAYBACK_MODES.transcode,
        isLan: false,
        remote: { remoteLimit: 'high1080', uploadMbps: null },
        defaultBitrate: 8_000_000,
      }),
    ).toBeNull()
  })

  it('leaves a viewer at home, a remux, a smaller size and no limit as asked', () => {
    const base = { sized: asked, remote: limited, defaultBitrate: 8_000_000 } as const
    expect(sizeForNetwork({ ...base, mode: PLAYBACK_MODES.transcode, isLan: true })).toBe(asked)
    expect(sizeForNetwork({ ...base, mode: PLAYBACK_MODES.remux, isLan: false })).toBe(asked)
    const small = { key: 'sd480', size: STREAM_QUALITIES.sd480 } as const
    expect(
      sizeForNetwork({ ...base, sized: small, mode: PLAYBACK_MODES.transcode, isLan: false }),
    ).toBe(small)
    expect(
      sizeForNetwork({
        ...base,
        remote: { remoteLimit: REMOTE_LIMITS.original, uploadMbps: null },
        mode: PLAYBACK_MODES.transcode,
        isLan: false,
      }),
    ).toBe(asked)
  })
})
