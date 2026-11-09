import type { IconName } from '@raven/ui/iconDrawings'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import {
  type DownloadEntry,
  isDone,
  isFailed,
  isUnderway,
  keyOfEntry,
} from '@/downloads/downloadEntries'
import { underwayTextOf } from '@/downloads/downloadStatusText'
import type { DownloadReading } from '@/stores/downloadProgress'

/** What pressing a Download button does. */
export const DOWNLOAD_ACTIONS = {
  download: 'download',
  cancel: 'cancel',
  retry: 'retry',
  remove: 'remove',
  none: 'none',
} as const

export type DownloadAction = (typeof DOWNLOAD_ACTIONS)[keyof typeof DOWNLOAD_ACTIONS]

/** A Download button as it is drawn and said: its words, its icon, whether it is on, and what it does. */
export type DownloadControl = {
  label: string
  text: string
  icon: IconName
  /** Drawn filled: everything asked for is on the device. */
  isOn: boolean
  /** Drawn faint, its press doing nothing: a group on its way. */
  isDisabled: boolean
  action: DownloadAction
}

/** A Download button: its face, and what its press does. */
export type DownloadButton = { control: DownloadControl; onPress: () => void }

type ControlOfProps = {
  /** The downloads already asked for of what the button is for. */
  held: readonly DownloadEntry[]
  /** How many files the button is for: 1 for a movie or an episode, a season's or an album's count. */
  wanted: number
  readings: Readonly<Record<string, DownloadReading>>
  /** What the button is said to download: "Season 1", the album's name. */
  name: string
  /** Why nothing of it can download to this device; null when it can. */
  blocked: string | null
}

/**
 * A Download button's face, as the web's desktop button reads: Download, then how far one file
 * has come (Cancel on a press) or how many of a group are in, then Downloaded (Delete on a
 * press) once all of it is, or Retry once one failed. With nothing held of what cannot come to
 * this device, a faint Download says why.
 */
export const downloadControlOf = ({
  held,
  wanted,
  readings,
  name,
  blocked,
}: ControlOfProps): DownloadControl => {
  const underway = held.filter(isUnderway)
  const done = held.filter(isDone)
  const download: DownloadControl = {
    label: wanted > 1 ? DOWNLOAD_COPY.downloadAll(name) : DOWNLOAD_COPY.download,
    text: DOWNLOAD_COPY.download,
    icon: 'download',
    isOn: false,
    isDisabled: false,
    action: DOWNLOAD_ACTIONS.download,
  }
  if (blocked !== null && held.length === 0) {
    return { ...download, label: blocked, isDisabled: true, action: DOWNLOAD_ACTIONS.none }
  }
  const [only] = underway
  if (only !== undefined && held.length === 1) {
    const text = underwayTextOf({ status: only.status, reading: readings[keyOfEntry(only)] })
    return {
      ...download,
      label: `${text}. ${DOWNLOAD_COPY.cancelDownload(name)}`,
      text,
      icon: 'close',
      action: DOWNLOAD_ACTIONS.cancel,
    }
  }
  if (underway.length > 0) {
    const text = DOWNLOAD_COPY.downloadingSome({ done: done.length, total: held.length })
    return { ...download, label: text, text, isDisabled: true, action: DOWNLOAD_ACTIONS.none }
  }
  if (held.some(isFailed)) {
    return {
      ...download,
      label: DOWNLOAD_COPY.retryDownload,
      text: DOWNLOAD_COPY.retry,
      action: DOWNLOAD_ACTIONS.retry,
    }
  }
  if (done.length > 0 && done.length >= wanted) {
    return {
      ...download,
      label: `${DOWNLOAD_COPY.downloaded}. ${DOWNLOAD_COPY.deleteDownload}`,
      text: DOWNLOAD_COPY.downloaded,
      icon: 'check',
      isOn: true,
      action: DOWNLOAD_ACTIONS.remove,
    }
  }
  return download
}
