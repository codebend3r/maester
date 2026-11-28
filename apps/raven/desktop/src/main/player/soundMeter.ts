import type { SoundMeasure } from '@raven/core'
import { MPV_PROPERTIES, type MpvPropertyValue } from '@raven/mpv'
import type { Timers } from '@shared/desktop'
import type { MpvControl } from '@/main/player/guardedMpv'

/** How long after a read is answered the next one starts, so the page hears at most 25 a second. */
export const METER_READ_MS = 40

/** The quietest level a measure carries, in dBFS: digital silence reads as this. */
export const METER_FLOOR_DB = -120

/**
 * The filters that measure what plays, last in the track's `af`, so they hear it after the
 * levelling and the equalizer. Both only read the samples and pass them on unchanged: `astats`
 * puts each frame's overall RMS and peak in its metadata, and `aspectralstats` each channel's
 * spectral centroid. ffmpeg has no filter that measures bands without splitting the sound,
 * and a split's measures never reach the frames mpv reports on, so the page spreads these into
 * its bars.
 */
export const METER_FILTERS = [
  'astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level+Peak_level',
  'aspectralstats=win_size=1024:measure=centroid',
].join(',')

/** The metadata keys the meter's filters write. */
const METER_KEYS = {
  rms: 'lavfi.astats.Overall.RMS_level',
  peak: 'lavfi.astats.Overall.Peak_level',
} as const

/** `aspectralstats` writes one centroid per channel, numbered from 1. */
const CENTROID_KEY = /^lavfi\.aspectralstats\.\d+\.centroid$/

/** How ffmpeg writes the level of a frame of digital silence. */
const SILENT_LEVEL = '-inf'

type Metadata = MpvPropertyValue<typeof MPV_PROPERTIES.afMeter>

/** A level in dBFS as ffmpeg writes it, floored; null for a key it did not write, or text that is no level. */
const levelOf = (text: string | undefined): number | null => {
  if (text === undefined) return null
  if (text === SILENT_LEVEL) return METER_FLOOR_DB
  const value = Number(text)
  return Number.isFinite(value) ? Math.max(value, METER_FLOOR_DB) : null
}

/** The channels' centroids averaged; null when none is a number, as for silence (`nan`). */
const centroidOf = (metadata: Metadata): number | null => {
  const centroids = Object.entries(metadata)
    .filter(([key]) => CENTROID_KEY.test(key))
    .map(([, text]) => Number(text))
    .filter((value) => Number.isFinite(value) && value >= 0)
  if (centroids.length === 0) return null
  return centroids.reduce((sum, value) => sum + value, 0) / centroids.length
}

/** What mpv's meter reported, or null before its filters have measured a frame. */
export const measureOf = (metadata: Metadata): SoundMeasure | null => {
  const rms = levelOf(metadata[METER_KEYS.rms])
  const peak = levelOf(metadata[METER_KEYS.peak])
  if (rms === null || peak === null) return null
  return { rms, peak, centroid: centroidOf(metadata) }
}

type CreateSoundMeterProps = {
  mpv: Pick<MpvControl, 'read'>
  timers: Timers
  /** Hands the page each measure read, at most one every `METER_READ_MS`. */
  send: (measure: SoundMeasure) => void
}

type SoundMeter = {
  /** Reads mpv's meter while `isOn`, and stops reading, with nothing more sent, once it is not. */
  set: (isOn: boolean) => void
}

/**
 * Reads what mpv measured of the music while it plays and sends it on. Each read is scheduled
 * `METER_READ_MS` after the one before it is answered, so reads never pile up behind a busy
 * mpv and the page hears at most 25 a second, and a read that fails (the meter is not there
 * while a track opens) is skipped.
 */
export const createSoundMeter = ({ mpv, timers, send }: CreateSoundMeterProps): SoundMeter => {
  let timer: unknown = null
  let isOn = false
  // Bumped by every start and stop, so a read answered after a stop sends nothing.
  let run = 0

  const readMeasure = async (): Promise<SoundMeasure | null> => {
    try {
      return measureOf(await mpv.read({ name: MPV_PROPERTIES.afMeter }))
    } catch {
      return null
    }
  }

  const schedule = (token: number) => {
    timer = timers.set({
      run: () => {
        timer = null
        tick(token).catch(() => undefined)
      },
      ms: METER_READ_MS,
    })
  }

  const tick = async (token: number) => {
    const measure = await readMeasure()
    if (token !== run) return
    if (measure !== null) send(measure)
    schedule(token)
  }

  const start = () => {
    isOn = true
    run += 1
    schedule(run)
  }

  const stop = () => {
    isOn = false
    run += 1
    if (timer !== null) timers.clear(timer)
    timer = null
  }

  return {
    set: (shouldRun) => {
      if (shouldRun === isOn) return
      if (shouldRun) start()
      else stop()
    },
  }
}
