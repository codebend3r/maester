import {
  DESKTOP_REQUESTS,
  DOWNLOAD_TARGET_KINDS,
  type DownloadTarget,
  downloadLinkFor,
} from '@raven/core'
import { Button } from '@raven/ui'
import { usePlayerPrefs } from '@raven/ui/headless'
import { type ComponentType, useRef, useState } from 'react'
import { DOWNLOAD_BUTTON_COPY } from '@/components/DownloadButton/copy'
import { UnsupportedDownloadButton } from '@/components/DownloadButton/DolbyVisionNote'
import { handled } from '@/desktop/handled'
import { useOpenReply } from '@/desktop/openReply'
import { ravenPlayer } from '@/lib/ravenPlayer'
import type { DownloadsHost } from '@/downloads/host'
import { useDownloadsHostOrNone } from '@/stores/downloadsHost'
import { COMMON_COPY } from '@/lib/copy'

/** Where the button hands the title: the page's own downloads, Raven beside the browser, or nowhere; `unsupported` is a title the host keeps none of. */
const DOWNLOAD_WAYS = {
  host: 'host',
  link: 'link',
  unsupported: 'unsupported',
  none: 'none',
} as const

type DownloadWay = (typeof DOWNLOAD_WAYS)[keyof typeof DOWNLOAD_WAYS]

type DownloadWayProps = { target: DownloadTarget }

type HostDownloadButtonProps = DownloadWayProps

/** Where the page keeps downloads: the host reads the title and asks before it downloads. */
const HostDownloadButton = ({ target }: HostDownloadButtonProps) => {
  const host = useDownloadsHostOrNone()
  const openReply = useOpenReply()
  // One ask at a time: a second click while the host reads the title would ask twice.
  const isAskingNow = useRef(false)
  const [isAsking, setIsAsking] = useState(false)
  const ask = async () => {
    if (isAskingNow.current || host === null) return
    isAskingNow.current = true
    setIsAsking(true)
    const reply = await host.request({ type: DESKTOP_REQUESTS.askDownload, target })
    isAskingNow.current = false
    setIsAsking(false)
    openReply(reply)
  }
  return (
    // aria-disabled, not disabled: disabling the focused button would drop focus to the page.
    <Button icon="download" data-wide aria-disabled={isAsking} onClick={() => handled(ask())}>
      {COMMON_COPY.download}
    </Button>
  )
}

type LinkDownloadButtonProps = DownloadWayProps

/** In a browser that keeps none of its own: a `raven://download` link the installed Raven opens. */
const LinkDownloadButton = ({ target }: LinkDownloadButtonProps) => (
  <Button
    icon="download"
    data-wide
    onClick={() => ravenPlayer.open(downloadLinkFor({ origin: window.location.origin, target }))}
  >
    {DOWNLOAD_BUTTON_COPY.downloadToRaven}
  </Button>
)

const NoDownload = () => null

const DOWNLOAD_VIEWS = {
  [DOWNLOAD_WAYS.host]: HostDownloadButton,
  [DOWNLOAD_WAYS.link]: LinkDownloadButton,
  [DOWNLOAD_WAYS.unsupported]: UnsupportedDownloadButton,
  [DOWNLOAD_WAYS.none]: NoDownload,
} as const satisfies Record<DownloadWay, ComponentType<DownloadWayProps>>

const isMusicTarget = ({ kind }: DownloadTarget): boolean =>
  kind === DOWNLOAD_TARGET_KINDS.album || kind === DOWNLOAD_TARGET_KINDS.playlist

type DownloadWayOfProps = {
  host: DownloadsHost | null
  target: DownloadTarget
  isDolbyVisionOnly: boolean
  opensInRavenPlayer: boolean
}

const downloadWayOf = ({
  host,
  target,
  isDolbyVisionOnly,
  opensInRavenPlayer,
}: DownloadWayOfProps): DownloadWay => {
  if (host !== null && isDolbyVisionOnly && !host.canKeepDolbyVision) {
    return DOWNLOAD_WAYS.unsupported
  }
  if (host !== null && (host.canKeepMusic || !isMusicTarget(target))) return DOWNLOAD_WAYS.host
  // Only what the page's own host does not keep goes to Raven beside the browser, where it is installed.
  return opensInRavenPlayer ? DOWNLOAD_WAYS.link : DOWNLOAD_WAYS.none
}

type DownloadButtonProps = {
  target: DownloadTarget
  /** The title is one video in Dolby Vision profile 5, which only some hosts keep; a title of many files leaves it out. */
  isDolbyVisionOnly?: boolean
}

/**
 * Keeps a title to play with no server. Where the page keeps downloads, inside Raven or in a
 * browser that can, it asks that host itself; a browser keeps videos only, so an album or a
 * playlist falls to the link, and a Dolby Vision only video in a browser that does not play it
 * is greyed out, with a note saying DV5 downloads are unsupported. Elsewhere it is shown only where this browser says Raven is
 * installed, as Settings' toggle does, and opens a `raven://download` link. Its label cannot
 * wrap or shrink, so it marks itself wide and the header's action row makes room for it (see
 * ItemHeader).
 */
export const DownloadButton = ({ target, isDolbyVisionOnly = false }: DownloadButtonProps) => {
  const host = useDownloadsHostOrNone()
  const opensInRavenPlayer = usePlayerPrefs((prefs) => prefs.opensInRavenPlayer)
  const View: ComponentType<DownloadWayProps> =
    DOWNLOAD_VIEWS[downloadWayOf({ host, target, isDolbyVisionOnly, opensInRavenPlayer })]
  return <View target={target} />
}
