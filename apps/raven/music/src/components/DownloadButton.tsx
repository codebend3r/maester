import type { Track } from '@raven/core'
import type { IconName } from '@raven/ui/iconDrawings'

import { ActionButton } from '@/components/Controls'
import {
  DOWNLOAD_PROGRESS,
  type DownloadCollection,
  downloadProgressOf,
  useDownloads,
} from '@/downloads/downloadStore'
import { DOWNLOAD_BUTTON_COPY } from '@/screens/copy'
import { WREN_ICONS } from '@/theme/icons'

type DownloadAction = { label: string; icon: IconName; onPress: () => void; isDisabled: boolean }

const IGNORED = (): void => undefined

type DownloadButtonProps = {
  serverId: string
  tracks: readonly Track[]
  collection: DownloadCollection
  /** Hears why a download was refused (the storage limit), or null once one starts. */
  onRefusal: (message: string | null) => void
}

/**
 * An album's or a playlist's download: Download, then how far it has come, then Remove
 * download once every track is on the device, or Retry download when one failed.
 */
export function DownloadButton({ serverId, tracks, collection, onRefusal }: DownloadButtonProps) {
  const entries = useDownloads((state) => state.entries)
  const downloadTracks = useDownloads((state) => state.downloadTracks)
  const remove = useDownloads((state) => state.remove)
  const mediaIds = tracks.map(({ id }) => id)
  const progress = downloadProgressOf({ entries, serverId, mediaIds })
  const download = () => {
    onRefusal(null)
    downloadTracks({ serverId, tracks, collection }).then(onRefusal, IGNORED)
  }
  const actions = {
    [DOWNLOAD_PROGRESS.none]: {
      label: DOWNLOAD_BUTTON_COPY.download,
      icon: WREN_ICONS.download,
      onPress: download,
      isDisabled: false,
    },
    // On its way, it is shown and said as dimmed rather than pressed to no end.
    [DOWNLOAD_PROGRESS.downloading]: {
      label: DOWNLOAD_BUTTON_COPY.downloading(progress),
      icon: WREN_ICONS.download,
      onPress: IGNORED,
      isDisabled: true,
    },
    [DOWNLOAD_PROGRESS.done]: {
      label: DOWNLOAD_BUTTON_COPY.remove,
      icon: WREN_ICONS.downloaded,
      onPress: () => {
        remove({ serverId, mediaIds }).catch(IGNORED)
      },
      isDisabled: false,
    },
    [DOWNLOAD_PROGRESS.failed]: {
      label: DOWNLOAD_BUTTON_COPY.retry,
      icon: WREN_ICONS.download,
      onPress: download,
      isDisabled: false,
    },
  } as const satisfies Record<typeof progress.kind, DownloadAction>
  const { label, icon, onPress, isDisabled } = actions[progress.kind]
  return <ActionButton icon={icon} isDisabled={isDisabled} label={label} onPress={onPress} />
}
