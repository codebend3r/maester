import { type ApiClient, LIBRARY_KINDS, type Library, matchTypeFor } from '@raven/core'
import { useServerLibraryActions } from '@raven/ui/headless'

import type { LibraryCardAction, LibraryCardLine } from '@/layouts/librariesKit'
import { LIBRARY_ACTIONS_COPY } from '@/screens/adminCopy'
import { APP_ICONS } from '@/theme/icons'

/** Each of a library's buttons, by name, so a card's list keys them and a test finds them. */
const LIBRARY_WORK = {
  matchAgain: 'matchAgain',
  quickScan: 'quickScan',
  fullScan: 'fullScan',
  scanMarkers: 'scanMarkers',
  mergeAlbums: 'mergeAlbums',
  updateRatings: 'updateRatings',
} as const

/** What a merge says it did: none found, or how many albums it joined. */
const mergedLineOf = (merged: number): string => {
  if (merged === 0) return LIBRARY_ACTIONS_COPY.noAlbumsMerged
  return LIBRARY_ACTIONS_COPY.albumsMerged(merged)
}

type LongActionOfProps = {
  key: string
  label: string
  icon: LibraryCardAction['icon']
  library: Library
  isRunning: boolean
  isDisabled: boolean
  isCancelling: boolean
  onStart: () => void
  onCancel: () => void
}

/** A long action's button, which becomes its Cancel while it runs, in the same place, as the web's. */
const longActionOf = ({
  key,
  label,
  icon,
  library,
  isRunning,
  isDisabled,
  isCancelling,
  onStart,
  onCancel,
}: LongActionOfProps): LibraryCardAction => {
  const text = isRunning ? LIBRARY_ACTIONS_COPY.cancel(label) : label
  return {
    key,
    text,
    icon: isRunning ? APP_ICONS.close : icon,
    name: LIBRARY_ACTIONS_COPY.named({ label: text, library: library.name }),
    isDisabled: isRunning ? isCancelling : isDisabled,
    onPress: isRunning ? onCancel : onStart,
  }
}

/** A button with whether the library's type offers it: Match again only to a matched library, Merge only to music. */
type OfferedAction = LibraryCardAction & { isOffered: boolean }

type LibraryCardWorkProps = { api: ApiClient; library: Library }

/** What an owner's library card holds open: its buttons, and a line for each answer and refusal. */
export type LibraryCardWork = {
  actions: LibraryCardAction[]
  lines: LibraryCardLine[]
}

/**
 * A library's work on its card, the web's library actions in their order: Match again, Quick
 * scan, Full scan, Scan intros and credits, Merge duplicate albums and Update ratings, each
 * long one becoming its Cancel while it runs, and why any of them was refused.
 */
export const useLibraryCardWork = ({ api, library }: LibraryCardWorkProps): LibraryCardWork => {
  const {
    quickScan,
    cancelQuickScan,
    fullScan,
    cancelFullScan,
    scanMarkers,
    updateRatings,
    cancelRatings,
    rematch,
    mergeAlbums,
    isBusy,
    isQuickScanning,
    isFullScanning,
    isUpdatingRatings,
  } = useServerLibraryActions({ api, library })
  const isMatched = matchTypeFor(library.settings.kind) !== null
  const isMusic = library.settings.kind === LIBRARY_KINDS.music
  const named = (label: string) => LIBRARY_ACTIONS_COPY.named({ label, library: library.name })
  // Each button, in the web's order, with whether this library's type offers it.
  const offered: OfferedAction[] = [
    {
      isOffered: isMatched,
      key: LIBRARY_WORK.matchAgain,
      text: LIBRARY_ACTIONS_COPY.matchAgain,
      icon: APP_ICONS.search,
      name: named(LIBRARY_ACTIONS_COPY.matchAgain),
      isDisabled: library.unmatchedCount === 0 || rematch.isPending,
      onPress: () => rematch.mutate(),
    },
    {
      isOffered: true,
      ...longActionOf({
        key: LIBRARY_WORK.quickScan,
        label: LIBRARY_ACTIONS_COPY.quickScan,
        icon: APP_ICONS.forward,
        library,
        isRunning: isQuickScanning,
        isDisabled: isBusy,
        isCancelling: cancelQuickScan.isPending,
        onStart: () => quickScan.mutate(),
        onCancel: () => cancelQuickScan.mutate(),
      }),
    },
    {
      isOffered: true,
      ...longActionOf({
        key: LIBRARY_WORK.fullScan,
        label: LIBRARY_ACTIONS_COPY.fullScan,
        icon: APP_ICONS.rescan,
        library,
        isRunning: isFullScanning,
        isDisabled: isBusy,
        isCancelling: cancelFullScan.isPending,
        onStart: () => fullScan.mutate(),
        onCancel: () => cancelFullScan.mutate(),
      }),
    },
    {
      isOffered: isMatched,
      key: LIBRARY_WORK.scanMarkers,
      text: LIBRARY_ACTIONS_COPY.scanMarkers,
      icon: APP_ICONS.skipNext,
      name: named(LIBRARY_ACTIONS_COPY.scanMarkers),
      isDisabled: isBusy,
      onPress: () => scanMarkers.mutate(),
    },
    {
      isOffered: isMusic,
      key: LIBRARY_WORK.mergeAlbums,
      text: LIBRARY_ACTIONS_COPY.mergeAlbums,
      icon: APP_ICONS.shuffle,
      name: named(LIBRARY_ACTIONS_COPY.mergeAlbums),
      isDisabled: mergeAlbums.isPending,
      onPress: () => mergeAlbums.mutate(),
    },
    {
      isOffered: true,
      ...longActionOf({
        key: LIBRARY_WORK.updateRatings,
        label: LIBRARY_ACTIONS_COPY.updateRatings,
        icon: APP_ICONS.gauge,
        library,
        isRunning: isUpdatingRatings,
        isDisabled: isBusy,
        isCancelling: cancelRatings.isPending,
        onStart: () => updateRatings.mutate(),
        onCancel: () => cancelRatings.mutate(),
      }),
    },
  ]
  const actions = offered.flatMap(({ isOffered, ...action }) => (isOffered ? [action] : []))
  const answers: LibraryCardLine[] = [
    scanMarkers.isSuccess
      ? { key: LIBRARY_WORK.scanMarkers, text: LIBRARY_ACTIONS_COPY.markersQueued, isAlert: false }
      : null,
    mergeAlbums.data === undefined
      ? null
      : {
          key: LIBRARY_WORK.mergeAlbums,
          text: mergedLineOf(mergeAlbums.data.merged),
          isAlert: false,
        },
  ].filter((line) => line !== null)
  const refusals = [
    { label: LIBRARY_ACTIONS_COPY.quickScan, error: quickScan.error ?? cancelQuickScan.error },
    { label: LIBRARY_ACTIONS_COPY.fullScan, error: fullScan.error ?? cancelFullScan.error },
    { label: LIBRARY_ACTIONS_COPY.scanMarkers, error: scanMarkers.error },
    { label: LIBRARY_ACTIONS_COPY.mergeAlbums, error: mergeAlbums.error },
    {
      label: LIBRARY_ACTIONS_COPY.updateRatings,
      error: updateRatings.error ?? cancelRatings.error,
    },
    { label: LIBRARY_ACTIONS_COPY.matchAgain, error: rematch.error },
  ].flatMap(({ label, error }) =>
    error === null
      ? []
      : [
          {
            key: `${label}-failed`,
            text: LIBRARY_ACTIONS_COPY.couldNot({
              verb: label.toLowerCase(),
              message: error.message,
            }),
            isAlert: true,
          },
        ],
  )
  return { actions, lines: [...answers, ...refusals] }
}
