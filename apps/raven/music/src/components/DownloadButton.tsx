import type { Track } from '@raven/core'
import { IGNORED } from '@raven/native/headless'
import { type ReactNode, useState } from 'react'

import { DOWNLOAD_BUTTON_COPY } from '@/components/copy'
import { DetailAction } from '@/components/DetailAction'
import { type DownloadCollection, useDownloads } from '@/downloads/downloadStore'
import { DOWNLOAD_PROGRESS, downloadProgressOf } from '@/downloads/downloadViews'
import type { Cover } from '@/music/useCovers'
import { ProgressRing } from '@/ui/ProgressRing'
import { SheetActions } from '@/ui/SheetActions'
import { useToast } from '@/stores/toast'
import { useWrenTheme } from '@/theme/wrenTheme'
import { SIZE } from '@/theme/wrenTokens'
import { BottomSheet } from '@/ui/BottomSheet'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

/** What the button shows and does in one state of its download. */
type DownloadAction = {
  label: string
  spoken: string
  glyph: ReactNode
  onPress: () => void
  isDisabled: boolean
}

type DownloadButtonProps = {
  serverId: string
  tracks: readonly Track[]
  collection: DownloadCollection
  /** The album's or playlist's name and cover, at the top of the Remove download sheet. */
  title: string
  cover: Cover | null
}

/**
 * An album's or a playlist's download: Download, then a ring filling as its tracks arrive, then
 * Downloaded in red, which offers Remove download, or Retry when one failed. A download the
 * storage limit refuses says why in a toast.
 */
export function DownloadButton({
  serverId,
  tracks,
  collection,
  title,
  cover,
}: DownloadButtonProps) {
  const { colors } = useWrenTheme()
  const entries = useDownloads((state) => state.entries)
  const playlists = useDownloads((state) => state.playlists)
  const downloadTracks = useDownloads((state) => state.downloadTracks)
  const remove = useDownloads((state) => state.remove)
  const [isRemoving, setIsRemoving] = useState(false)
  const mediaIds = tracks.map(({ id }) => id)
  const progress = downloadProgressOf({ entries, playlists, serverId, mediaIds, collection })
  const download = () => {
    downloadTracks({ serverId, tracks, collection }).then((refusal) => {
      if (refusal !== null) useToast.getState().show(refusal)
    }, IGNORED)
  }
  const removeDownload = () => {
    setIsRemoving(false)
    remove({ serverId, collection }).catch(IGNORED)
  }
  const actions = {
    [DOWNLOAD_PROGRESS.none]: {
      label: DOWNLOAD_BUTTON_COPY.download,
      spoken: DOWNLOAD_BUTTON_COPY.download,
      glyph: <WrenIcon color={colors.text2} name={ICONS.download} />,
      onPress: download,
      isDisabled: false,
    },
    // On its way, it is shown and said as dimmed rather than pressed to no end.
    [DOWNLOAD_PROGRESS.downloading]: {
      label: DOWNLOAD_BUTTON_COPY.progress(progress),
      spoken: DOWNLOAD_BUTTON_COPY.downloading(progress),
      glyph: <ProgressRing share={progress.total === 0 ? 0 : progress.done / progress.total} />,
      onPress: IGNORED,
      isDisabled: true,
    },
    [DOWNLOAD_PROGRESS.done]: {
      label: DOWNLOAD_BUTTON_COPY.downloaded,
      spoken: DOWNLOAD_BUTTON_COPY.downloaded,
      glyph: <WrenIcon color={colors.accentText} name={ICONS.downloaded} size={SIZE.icon} />,
      onPress: () => setIsRemoving(true),
      isDisabled: false,
    },
    [DOWNLOAD_PROGRESS.failed]: {
      label: DOWNLOAD_BUTTON_COPY.retryShort,
      spoken: DOWNLOAD_BUTTON_COPY.retry,
      glyph: <WrenIcon color={colors.accentText} name={ICONS.alert} />,
      onPress: download,
      isDisabled: false,
    },
  } as const satisfies Record<typeof progress.kind, DownloadAction>
  const { label, spoken, glyph, onPress, isDisabled } = actions[progress.kind]
  return (
    <>
      <DetailAction
        glyph={glyph}
        isDisabled={isDisabled}
        label={label}
        onPress={onPress}
        spoken={spoken}
      />
      <BottomSheet
        head={{ title, subtitle: DOWNLOAD_BUTTON_COPY.downloaded, cover }}
        isOpen={isRemoving}
        onClose={() => setIsRemoving(false)}
      >
        <SheetActions
          groups={[
            [{ icon: ICONS.trash, label: DOWNLOAD_BUTTON_COPY.remove, onPress: removeDownload }],
          ]}
        />
      </BottomSheet>
    </>
  )
}
