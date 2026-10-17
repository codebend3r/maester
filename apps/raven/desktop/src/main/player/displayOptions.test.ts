import { expect, test } from 'bun:test'
import { displayOptions, displayReading } from '@/main/player/displayOptions'

test('a fast HDR display overrides the rate and hints the colorspace', () => {
  expect(displayOptions({ refreshRate: 120, edrHeadroom: 16 })).toEqual([
    { name: 'display-fps-override', value: 120 },
    { name: 'target-colorspace-hint', value: 'yes' },
  ])
})

test('an SDR display turns the hint off', () => {
  expect(displayOptions({ refreshRate: 60, edrHeadroom: 1 })).toEqual([
    { name: 'display-fps-override', value: 60 },
    { name: 'target-colorspace-hint', value: 'no' },
  ])
})

test('an unknown refresh rate sets only the hint', () => {
  expect(displayOptions({ refreshRate: 0, edrHeadroom: 1 })).toEqual([
    { name: 'target-colorspace-hint', value: 'no' },
  ])
})

test('a non-finite refresh rate sets only the hint', () => {
  ;[Number.POSITIVE_INFINITY, Number.NaN, -60].forEach((refreshRate) => {
    expect(displayOptions({ refreshRate, edrHeadroom: 1 })).toEqual([
      { name: 'target-colorspace-hint', value: 'no' },
    ])
  })
})

test('the window display frequency wins, the headroom comes from the surface', () => {
  expect(
    displayReading({ frequency: 120, display: () => ({ refreshRate: 60, edrHeadroom: 16 }) }),
  ).toEqual({ refreshRate: 120, edrHeadroom: 16 })
})

test('without a display frequency the surface rate is used', () => {
  ;[0, Number.NaN, -1].forEach((frequency) => {
    expect(
      displayReading({ frequency, display: () => ({ refreshRate: 59.94, edrHeadroom: 1 }) }),
    ).toEqual({ refreshRate: 59.94, edrHeadroom: 1 })
  })
})

test('a surface that throws (mpv destroyed) gives no reading', () => {
  expect(
    displayReading({
      frequency: 60,
      display: () => {
        throw new Error('mpv is destroyed')
      },
    }),
  ).toBeNull()
})
