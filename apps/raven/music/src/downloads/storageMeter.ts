import { formatBytes } from '@raven/core'

import { BYTES_PER_GB, usedBytesOf, useDownloads } from '@/downloads/downloadStore'
import { STORAGE_COPY } from '@/screens/copy'
import { useWrenPrefs } from '@/stores/wrenPrefs'

/** What the usage meter shows: its words, and how full its bar is, or no bar. */
type StorageMeter = { value: string; fraction: number | null }

type StorageMeterOfProps = {
  usedBytes: number
  /** Settings' storage limit in gigabytes; null for none. */
  limitGb: number | null
  /** The space left on the device; null when it cannot be read. */
  freeBytes: number | null
}

const clamped = (fraction: number): number => Math.min(1, Math.max(0, fraction))

/**
 * The downloads' share of the storage limit, or with no limit of the space they could grow
 * into (theirs and what is left on the device). With neither, the meter shows no bar.
 */
export const storageMeterOf = ({
  usedBytes,
  limitGb,
  freeBytes,
}: StorageMeterOfProps): StorageMeter => {
  const used = formatBytes(usedBytes)
  if (limitGb !== null) {
    return {
      value: STORAGE_COPY.usedOf({ used, limit: STORAGE_COPY.gigabytes(limitGb) }),
      fraction: clamped(usedBytes / (limitGb * BYTES_PER_GB)),
    }
  }
  const room = usedBytes + (freeBytes ?? 0)
  const hasRoom = freeBytes !== null && room > 0
  return { value: used, fraction: hasRoom ? clamped(usedBytes / room) : null }
}

/**
 * The downloads' meter now, as Settings and Library's Downloads both show it. The room left on
 * the device is read from the disk each time the meter draws, which it does again whenever the
 * downloads' bytes or the limit change; the store holds no such value to be told about, so it is
 * never read inside a selector.
 */
export const useStorageMeter = (): StorageMeter => {
  const usedBytes = useDownloads((state) => usedBytesOf(state.entries))
  const disk = useDownloads((state) => state.device.disk)
  const freeBytes = disk.freeBytes()
  const limitGb = useWrenPrefs((state) => state.storageLimitGb)
  return storageMeterOf({ usedBytes, limitGb, freeBytes })
}
