import { formatBytes } from '@raven/core'
import { describe, expect, it } from 'bun:test'

import { storageMeterOf } from '@/downloads/storageMeter'

describe('storageMeterOf', () => {
  it('measures the downloads against the storage limit', () => {
    expect(storageMeterOf({ usedBytes: 500_000_000, limitGb: 2, freeBytes: null })).toEqual({
      value: `${formatBytes(500_000_000)} of 2 GB`,
      fraction: 0.25,
    })
  })

  it('fills the bar no further than the limit', () => {
    expect(storageMeterOf({ usedBytes: 3_000_000_000, limitGb: 2, freeBytes: 0 }).fraction).toBe(1)
  })

  it('measures against the room left on the device when there is no limit', () => {
    expect(storageMeterOf({ usedBytes: 1_000_000, limitGb: null, freeBytes: 3_000_000 })).toEqual({
      value: formatBytes(1_000_000),
      fraction: 0.25,
    })
  })

  it('draws no bar with no limit and no reading of the device', () => {
    expect(storageMeterOf({ usedBytes: 7_100_000, limitGb: null, freeBytes: null })).toEqual({
      value: '7.1 MB',
      fraction: null,
    })
  })

  it('draws no bar when nothing is downloaded and the device is full', () => {
    expect(storageMeterOf({ usedBytes: 0, limitGb: null, freeBytes: 0 }).fraction).toBeNull()
  })
})
