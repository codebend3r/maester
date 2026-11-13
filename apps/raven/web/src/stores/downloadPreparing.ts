import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

type DownloadPreparing = {
  /**
   * How far along the server's copy of each download is, from 0 to 1, by `downloadId`. A browser
   * waits for a copy it can play before any byte comes; Raven keeps the original and has none.
   */
  progress: Readonly<Record<string, number>>
}

/** The server copies being made for downloads that wait on one, as their host reports them. */
export const useDownloadPreparing = create<DownloadPreparing>()(
  devtools((): DownloadPreparing => ({ progress: {} }), { name: 'raven/downloadPreparing' }),
)
