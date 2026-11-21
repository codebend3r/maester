import { describe, expect, it } from 'bun:test'
import { NOW_PLAYING_COPY } from '@raven/wren'

import { deviceOf } from '@/screens/nowPlaying/device'
import { FORM_FACTORS } from '@/theme/wrenTokens'

describe('deviceOf', () => {
  it('names the iPhone, the iPad and Android', () => {
    expect(deviceOf({ os: 'ios', formFactor: FORM_FACTORS.phone })).toBe(
      NOW_PLAYING_COPY.devices.iPhone,
    )
    expect(deviceOf({ os: 'ios', formFactor: FORM_FACTORS.tablet })).toBe(
      NOW_PLAYING_COPY.devices.iPad,
    )
    expect(deviceOf({ os: 'android', formFactor: FORM_FACTORS.tablet })).toBe(
      NOW_PLAYING_COPY.devices.android,
    )
  })
})
