import { DOWNLOAD_COPY } from '@/downloads/copy'
import type { DownloadsKit, DownloadsLayoutProps } from '@/layouts/downloadsKit'
import { focusItem } from '@/layouts/ItemLayout.focus'
import { CAN_DOWNLOAD } from '@/layouts/downloadKind'

/** A TV's Downloads, which no menu leads to: a line saying the TVs keep nothing on the device. */
const DownloadsLayout = ({ onBack }: DownloadsLayoutProps) => (
  <focusItem.ItemNotice notice={DOWNLOAD_COPY.notHere} onBack={onBack} />
)

export const focusDownloads: DownloadsKit = { DownloadsLayout, canDownload: CAN_DOWNLOAD.focus }
