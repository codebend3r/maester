import { confirmDelete } from '@/downloads/confirmDelete'
import {
  DOWNLOAD_ACTIONS,
  type DownloadAction,
  type DownloadButton,
  downloadControlOf,
} from '@/downloads/downloadControl'
import {
  type DownloadEntry,
  type DownloadLibrary,
  isFailed,
  isUnderway,
  keyOfEntry,
} from '@/downloads/downloadEntries'
import type { DownloadTarget } from '@/downloads/downloadTargets'
import { IGNORED } from '@/lib/ignore'
import { useDownloadProgress } from '@/stores/downloadProgress'
import { useDownloads } from '@/stores/downloads'

type EntryMatch = (entry: DownloadEntry) => boolean

const EVERY: EntryMatch = () => true

type UseDownloadButtonProps = {
  serverId: string
  /** The library the page or card asked from, filed on each download; null when it is not known. */
  library: DownloadLibrary | null
  /** What the button stands for: a movie's file, a season's episodes, an album's tracks. */
  target: DownloadTarget
}

/**
 * A Download button over the downloads store, for any page or card: Download asks for what the
 * target's `asks` reads; Cancel, Retry and Delete act on what it stands for, Delete once the
 * viewer has said yes.
 */
export const useDownloadButton = ({
  serverId,
  library,
  target,
}: UseDownloadButtonProps): DownloadButton => {
  const entries = useDownloads((state) => state.entries)
  const readings = useDownloadProgress((state) => state.readings)
  const { name, wanted, blocked } = target
  const held = Object.values(entries).filter(
    (entry) => entry.serverId === serverId && target.isFor(entry),
  )
  const keysOf = (match: EntryMatch): string[] => held.filter(match).map(keyOfEntry)
  const store = useDownloads.getState
  const removeAll = () => {
    Promise.all(keysOf(EVERY).map((key) => store().remove({ key }))).catch(IGNORED)
  }
  const presses = {
    [DOWNLOAD_ACTIONS.download]: () => {
      target
        .asks()
        .then((each) =>
          Promise.all(each.map((ask) => store().download({ serverId, library, ...ask }))),
        )
        .catch(IGNORED)
    },
    [DOWNLOAD_ACTIONS.cancel]: () => {
      Promise.all(keysOf(isUnderway).map((key) => store().cancel({ key }))).catch(IGNORED)
    },
    [DOWNLOAD_ACTIONS.retry]: () => {
      Promise.all(keysOf(isFailed).map((key) => store().retry({ key }))).catch(IGNORED)
    },
    [DOWNLOAD_ACTIONS.remove]: () => confirmDelete({ name, onDelete: removeAll }),
    [DOWNLOAD_ACTIONS.none]: IGNORED,
  } as const satisfies Record<DownloadAction, () => void>
  const control = downloadControlOf({ held, wanted, readings, name, blocked })
  return { control, onPress: presses[control.action] }
}
