import { DESKTOP_REQUESTS, type DownloadTarget, downloadLinkFor } from '@raven/core'
import { Button } from '@raven/ui'
import { usePlayerPrefs } from '@raven/ui/headless'
import { type ComponentType, useRef, useState } from 'react'
import { DOWNLOAD_BUTTON_COPY } from '@/components/DownloadButton/copy'
import { handled } from '@/desktop/handled'
import { useOpenReply } from '@/desktop/openReply'
import { ravenPlayer } from '@/lib/ravenPlayer'
import { useDesktopBridge } from '@/stores/desktop'
import { COMMON_COPY } from '@/lib/copy'

/** Where the button hands the title: Raven it runs in, Raven beside the browser, or nowhere. */
const DOWNLOAD_WAYS = { desktop: 'desktop', browser: 'browser', none: 'none' } as const

type DownloadWay = (typeof DOWNLOAD_WAYS)[keyof typeof DOWNLOAD_WAYS]

type DownloadWayProps = { target: DownloadTarget }

type DesktopDownloadButtonProps = DownloadWayProps

/** Inside Raven: main reads the title and asks before it downloads. */
const DesktopDownloadButton = ({ target }: DesktopDownloadButtonProps) => {
  const desktop = useDesktopBridge((state) => state.desktop)
  const openReply = useOpenReply()
  // One ask at a time: a second click while main reads the title would ask twice.
  const isAskingNow = useRef(false)
  const [isAsking, setIsAsking] = useState(false)
  const ask = async () => {
    if (isAskingNow.current || desktop === null) return
    isAskingNow.current = true
    setIsAsking(true)
    const reply = await desktop.client.request({ type: DESKTOP_REQUESTS.askDownload, target })
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

type BrowserDownloadButtonProps = DownloadWayProps

/** In a browser: a `raven://download` link the installed Raven opens. */
const BrowserDownloadButton = ({ target }: BrowserDownloadButtonProps) => (
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
  [DOWNLOAD_WAYS.desktop]: DesktopDownloadButton,
  [DOWNLOAD_WAYS.browser]: BrowserDownloadButton,
  [DOWNLOAD_WAYS.none]: NoDownload,
} as const satisfies Record<DownloadWay, ComponentType<DownloadWayProps>>

type DownloadWayOfProps = { isDesktop: boolean; opensInRavenPlayer: boolean }

const downloadWayOf = ({ isDesktop, opensInRavenPlayer }: DownloadWayOfProps): DownloadWay => {
  if (isDesktop) return DOWNLOAD_WAYS.desktop
  if (opensInRavenPlayer) return DOWNLOAD_WAYS.browser
  return DOWNLOAD_WAYS.none
}

type DownloadButtonProps = { target: DownloadTarget }

/**
 * Hands a title to Raven to keep on its disk. Inside Raven it
 * is always there and asks the app itself; in a browser it is shown only
 * where this browser says Raven is installed, as Settings' toggle
 * does, and opens a `raven://download` link. Its label cannot wrap or
 * shrink, so it marks itself wide and the header's action row makes room
 * for it (see ItemHeader).
 */
export const DownloadButton = ({ target }: DownloadButtonProps) => {
  const isDesktop = useDesktopBridge((state) => state.desktop !== null)
  const opensInRavenPlayer = usePlayerPrefs((prefs) => prefs.opensInRavenPlayer)
  const View: ComponentType<DownloadWayProps> =
    DOWNLOAD_VIEWS[downloadWayOf({ isDesktop, opensInRavenPlayer })]
  return <View target={target} />
}
