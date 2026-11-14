import { type SpeedSample, nextSample } from '@raven/core'
import type { DownloadReading } from '@raven/native/headless'
import { create } from 'zustand'

type ReadProps = { key: string; bytes: number; total: number; now: number }

type ForgetProps = { key: string }

export type DownloadProgress = {
  /** Each running download's last reading, by its key. */
  readings: Readonly<Record<string, DownloadReading>>
  /** How fast each running download is going, read off its readings. */
  samples: Readonly<Record<string, SpeedSample>>
  /** Folds a reading of `bytes` at `now` in. */
  read: (props: ReadProps) => void
  /** Lets go of a download that finished, failed or was cancelled. */
  forget: (props: ForgetProps) => void
}

/** What a running download's fetch tells the progress: each reading, and when it is over. */
export type DownloadProgressActions = Pick<DownloadProgress, 'read' | 'forget'>

type WithoutProps<T> = { record: Readonly<Record<string, T>>; key: string }

const without = <T>({ record, key }: WithoutProps<T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([each]) => each !== key))

/**
 * The running downloads' bytes and speeds, kept apart from the downloads themselves, so the
 * readings that come several times a second are never written to the device's storage.
 */
export const useDownloadProgress = create<DownloadProgress>()((set) => ({
  readings: {},
  samples: {},
  read: ({ key, bytes, total, now }) =>
    set((state) => ({
      readings: { ...state.readings, [key]: { bytes, total } },
      samples: {
        ...state.samples,
        [key]: nextSample({ previous: state.samples[key], bytes, now }),
      },
    })),
  forget: ({ key }) =>
    set((state) => ({
      readings: without({ record: state.readings, key }),
      samples: without({ record: state.samples, key }),
    })),
}))
