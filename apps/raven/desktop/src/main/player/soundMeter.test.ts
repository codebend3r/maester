import { describe, expect, test } from 'bun:test'
import type { SoundMeasure } from '@raven/core'
import { MPV_PROPERTIES } from '@raven/mpv'
import {
  createSoundMeter,
  METER_FLOOR_DB,
  METER_READ_MS,
  measureOf,
} from '@/main/player/soundMeter'
import { createFakeMpv, fakeTimers } from '@/main/test/playerFakes'

const RMS = 'lavfi.astats.Overall.RMS_level'
const PEAK = 'lavfi.astats.Overall.Peak_level'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('measureOf', () => {
  test('reads the overall RMS and peak and averages the channels centroids', () => {
    expect(
      measureOf({
        [RMS]: '-20.5',
        [PEAK]: '-4',
        'lavfi.aspectralstats.1.centroid': '900',
        'lavfi.aspectralstats.2.centroid': '1100',
        'lavfi.astats.Overall.Number_of_samples': '1024',
      }),
    ).toEqual({ rms: -20.5, peak: -4, centroid: 1000 })
  })

  test('reads silence as the floor, and a centroid that is no number as none', () => {
    expect(
      measureOf({ [RMS]: '-inf', [PEAK]: '-inf', 'lavfi.aspectralstats.1.centroid': 'nan' }),
    ).toEqual({ rms: METER_FLOOR_DB, peak: METER_FLOOR_DB, centroid: null })
    expect(measureOf({ [RMS]: '-200', [PEAK]: '-150' })).toEqual({
      rms: METER_FLOOR_DB,
      peak: METER_FLOOR_DB,
      centroid: null,
    })
  })

  test('is null before a frame was measured, or for a level that is no number', () => {
    expect(measureOf({})).toBeNull()
    expect(measureOf({ [RMS]: '-20' })).toBeNull()
    expect(measureOf({ [RMS]: 'loud', [PEAK]: '-3' })).toBeNull()
  })
})

const metadataOf = (rms: number) => ({ [RMS]: String(rms), [PEAK]: String(rms + 10) })

const setup = () => {
  const fake = createFakeMpv()
  const clock = fakeTimers()
  const sent: SoundMeasure[] = []
  const meter = createSoundMeter({
    mpv: fake.control,
    timers: clock.timers,
    send: (measure) => {
      sent.push(measure)
    },
  })
  /** Fires the read due now and lets mpv answer it. */
  const readOnce = async () => {
    const due = [...clock.pending.entries()].filter(([, timer]) => timer.ms === METER_READ_MS)
    due.forEach(([handle, timer]) => {
      clock.pending.delete(handle)
      timer.run()
    })
    await settle()
  }
  return { fake, clock, sent, meter, readOnce }
}

describe('createSoundMeter', () => {
  test('sends each measure it reads', async () => {
    const { fake, sent, meter, readOnce } = setup()
    meter.set(true)
    fake.values.set(MPV_PROPERTIES.afMeter, metadataOf(-30))
    await readOnce()
    fake.values.set(MPV_PROPERTIES.afMeter, metadataOf(-25))
    await readOnce()
    expect(sent.map(({ rms }) => rms)).toEqual([-30, -25])
    expect(fake.reads).toEqual([MPV_PROPERTIES.afMeter, MPV_PROPERTIES.afMeter])
  })

  test('reads again only once the last read is answered', async () => {
    const { fake, clock, meter, readOnce } = setup()
    fake.values.set(MPV_PROPERTIES.afMeter, metadataOf(-30))
    const release = fake.hold(`read ${MPV_PROPERTIES.afMeter}`)
    meter.set(true)
    await readOnce()
    expect(clock.pending.size).toBe(0)
    release()
    await settle()
    expect([...clock.pending.values()].map(({ ms }) => ms)).toEqual([METER_READ_MS])
  })

  test('a read answered after the stop sends nothing and schedules nothing', async () => {
    const { fake, clock, sent, meter, readOnce } = setup()
    fake.values.set(MPV_PROPERTIES.afMeter, metadataOf(-30))
    meter.set(true)
    await readOnce()
    const release = fake.hold(`read ${MPV_PROPERTIES.afMeter}`)
    await readOnce()
    meter.set(false)
    expect(clock.pending.size).toBe(0)
    release()
    await settle()
    expect(sent).toHaveLength(1)
    expect(clock.pending.size).toBe(0)
  })

  test('starting twice reads on one schedule, and a failed read is skipped', async () => {
    const { clock, sent, meter, readOnce } = setup()
    meter.set(true)
    meter.set(true)
    expect(clock.pending.size).toBe(1)
    await readOnce()
    expect(sent).toEqual([])
    expect(clock.pending.size).toBe(1)
  })
})
