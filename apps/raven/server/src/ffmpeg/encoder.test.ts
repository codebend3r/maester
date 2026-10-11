import { describe, expect, it } from 'vitest'
import { type HwAccel, encoderCandidates } from '@/ffmpeg/encoder'

const DEVICE = '/dev/dri/renderD128'

describe('encoderCandidates', () => {
  const CASES: Array<
    [string, { hwAccel: HwAccel; platform: string; deviceExists: boolean }, string[]]
  > = [
    [
      'auto on a Mac',
      { hwAccel: 'auto', platform: 'darwin', deviceExists: false },
      ['videotoolbox'],
    ],
    [
      'auto on Linux with a GPU',
      { hwAccel: 'auto', platform: 'linux', deviceExists: true },
      ['vaapi'],
    ],
    ['auto on Linux without one', { hwAccel: 'auto', platform: 'linux', deviceExists: false }, []],
    ['none, even with a GPU', { hwAccel: 'none', platform: 'linux', deviceExists: true }, []],
    [
      'vaapi asked for by name',
      { hwAccel: 'vaapi', platform: 'linux', deviceExists: true },
      ['vaapi'],
    ],
    [
      'vaapi with no device to use',
      { hwAccel: 'vaapi', platform: 'linux', deviceExists: false },
      [],
    ],
    [
      'videotoolbox off a Mac',
      { hwAccel: 'videotoolbox', platform: 'linux', deviceExists: true },
      [],
    ],
  ]

  it.each(CASES)('%s', (_name, input, kinds) => {
    expect(
      encoderCandidates({ ...input, vaapiDevice: DEVICE }).map((encoder) => encoder.kind),
    ).toEqual(kinds)
  })
})
