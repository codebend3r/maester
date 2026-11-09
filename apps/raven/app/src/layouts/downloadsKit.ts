import type { ReactNode } from 'react'

import type {
  FinishedGroup,
  FinishedRow,
  LibrarySection,
  UnderwayRow,
} from '@/downloads/downloadsPage'
import type { RowMove } from '@/layouts/sortableKit'
import type { Picture } from '@/queries/cards'
import type { DownloadsGrouping } from '@/stores/appPrefs'

/** A picture's and title art's addresses on this device. */
export type ShownPictures = { art: Picture | null; logo: Picture | null }

/** A finished group as the layout draws it: with its picture's and title art's addresses on this device. */
export type ShownGroup = FinishedGroup & ShownPictures

/** A library's finished groups as the layout draws them. */
export type ShownLibrarySection = Omit<LibrarySection, 'groups'> & { groups: readonly ShownGroup[] }

/** A download on its way as the layout draws it: with its title art's address on this device. */
export type ShownUnderway = UnderwayRow & ShownPictures

export type DownloadsLayoutProps = {
  /** "123.4 GB available"; null where the device cannot say. */
  available: string | null
  /** "Downloads use 4.2 GB". */
  used: string
  /** "12.4 MB/s" across every running download; null while none is moving. */
  speed: string | null
  underway: readonly ShownUnderway[]
  finished: readonly ShownGroup[]
  /** The same groups under their libraries, for the By library view. */
  finishedByLibrary: readonly ShownLibrarySection[]
  /** How the finished downloads are laid out, this device's choice. */
  grouping: DownloadsGrouping
  onGrouping: (grouping: DownloadsGrouping) => void
  onCancel: (row: UnderwayRow) => void
  onRetry: (row: UnderwayRow) => void
  /** Puts a queued download before another, or last (`before: null`). */
  onMove: (move: RowMove) => void
  /** Plays a finished video, or a group's tracks from the one pressed. */
  onPlay: (props: PlayRowProps) => void
  /** Plays a group: an album's or a playlist's tracks, a season's first episode. */
  onPlayGroup: (group: ShownGroup) => void
  onDelete: (row: FinishedRow) => void
  onDeleteGroup: (group: ShownGroup) => void
  onDeleteAll: () => void
  onBack: () => void
}

type PlayRowProps = { group: ShownGroup; row: FinishedRow }

/**
 * Downloads, which only the touch screens have: the TVs keep nothing on the device, so they draw
 * no Download button and their Downloads is a line saying so. A music page's Download is the
 * touch layouts' own (`DownloadChip`), since only they draw one.
 */
export type DownloadsKit = {
  DownloadsLayout: (props: DownloadsLayoutProps) => ReactNode
  /** Whether this device downloads at all, which puts Download on the item and music pages. */
  canDownload: boolean
}
