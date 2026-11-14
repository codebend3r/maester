import { FACT_PART_KINDS, PLAYBACK_MODES } from '@raven/core'
import { PLAYBACK_MODE_NAMES } from '@raven/ui/headless'
import { describe, expect, it } from 'bun:test'

import { NO_HEADING } from '@/layouts/playerHeading'
import { cornerFactsOf } from '@/layouts/playerKit'

const HDR_HEVC_4K = { ...NO_HEADING, quality: '4K', codec: 'HEVC', range: 'HDR' }
const CLOCK = '9:41 PM'

describe('cornerFactsOf', () => {
  it('shows the size, codec and range while the file reaches the screen as it is', () => {
    const corner = cornerFactsOf({
      mode: PLAYBACK_MODES.direct,
      heading: HDR_HEVC_4K,
      clock: CLOCK,
    })
    expect(corner.chips).toEqual([
      { kind: FACT_PART_KINDS.resolution, text: '4K' },
      { kind: FACT_PART_KINDS.codec, text: 'HEVC' },
      { kind: FACT_PART_KINDS.range, text: 'HDR' },
    ])
    expect(
      cornerFactsOf({ mode: PLAYBACK_MODES.remux, heading: HDR_HEVC_4K, clock: CLOCK }).chips,
    ).toHaveLength(3)
  })

  it('shows only the size while transcoding, since the codec and range are the server’s', () => {
    expect(
      cornerFactsOf({ mode: PLAYBACK_MODES.transcode, heading: HDR_HEVC_4K, clock: CLOCK }).chips,
    ).toEqual([{ kind: FACT_PART_KINDS.resolution, text: '4K' }])
  })

  it('leaves out what the index does not know', () => {
    expect(
      cornerFactsOf({ mode: null, heading: { ...HDR_HEVC_4K, range: null }, clock: CLOCK }).chips,
    ).toEqual([
      { kind: FACT_PART_KINDS.resolution, text: '4K' },
      { kind: FACT_PART_KINDS.codec, text: 'HEVC' },
    ])
  })

  it('names how the video plays, and reads the clock, the chips and the way out together', () => {
    const way = PLAYBACK_MODE_NAMES[PLAYBACK_MODES.transcode]
    expect(
      cornerFactsOf({ mode: PLAYBACK_MODES.transcode, heading: HDR_HEVC_4K, clock: CLOCK }),
    ).toEqual({
      clock: CLOCK,
      chips: [{ kind: FACT_PART_KINDS.resolution, text: '4K' }],
      way,
      label: `${CLOCK}, 4K, ${way}`,
    })
  })

  it('has no way while nothing plays yet', () => {
    const corner = cornerFactsOf({ mode: null, heading: NO_HEADING, clock: CLOCK })
    expect(corner.way).toBeNull()
    expect(corner.label).toBe(CLOCK)
  })
})
