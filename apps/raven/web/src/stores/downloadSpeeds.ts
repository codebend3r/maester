import { DOWNLOAD_STATUS_KINDS, type DownloadView } from '@raven/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { nextSample, type SpeedSample } from '@/desktop/downloadSpeed'

type ObserveProps = { downloads: readonly DownloadView[]; now: number }

type DownloadSpeeds = {
  /** The last reading of each download that is downloading, by `downloadId`. */
  samples: Readonly<Record<string, SpeedSample>>
  /** Folds the list main just sent in: a sample for each file on its way, none for the rest. */
  observe: (props: ObserveProps) => void
}

/** How fast each download is going, read off the bytes main reports between its progress events. */
export const useDownloadSpeeds = create<DownloadSpeeds>()(
  devtools(
    (set) => ({
      samples: {},
      observe: ({ downloads, now }) =>
        set((state) => ({
          samples: downloads.reduce<Record<string, SpeedSample>>((samples, view) => {
            if (view.status.kind !== DOWNLOAD_STATUS_KINDS.downloading) return samples
            return {
              ...samples,
              [view.downloadId]: nextSample({
                previous: state.samples[view.downloadId],
                bytes: view.status.bytes,
                now,
              }),
            }
          }, {}),
        })),
    }),
    { name: 'raven/downloadSpeeds' },
  ),
)
