import { DESKTOP_REQUESTS, type DownloadTarget, downloadLinkFor } from '@raven/core'
import { Button } from '@raven/ui'
import { usePlayerPrefs } from '@raven/ui/headless'
import { useRef, useState } from 'react'
import { handled } from '@/desktop/handled'
import { useOpenReply } from '@/desktop/openReply'
import { ravenPlayer } from '@/lib/ravenPlayer'
import { type Desktop, useDesktopBridge } from '@/stores/desktop'

/** Inside Raven: main reads the title and asks before it downloads. */
const DesktopDownloadButton = ({
  desktop,
  target,
}: {
  desktop: Desktop
  target: DownloadTarget
}) => {
  const openReply = useOpenReply()
  // One ask at a time: a second click while main reads the title would ask twice.
  const isAskingNow = useRef(false)
  const [isAsking, setIsAsking] = useState(false)
  const ask = async () => {
    if (isAskingNow.current) return
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
      Download
    </Button>
  )
}

/**
 * Hands a title to Raven to keep on its disk. Inside Raven it
 * is always there and asks the app itself; in a browser it is shown only
 * where this browser says Raven is installed, as Settings' toggle
 * does, and opens a `raven://download` link. Its label cannot wrap or
 * shrink, so it marks itself wide and the header's action row makes room
 * for it (see ItemHeader).
 */
export const DownloadButton = ({ target }: { target: DownloadTarget }) => {
  const desktop = useDesktopBridge((state) => state.desktop)
  const opensInRavenPlayer = usePlayerPrefs((prefs) => prefs.opensInRavenPlayer)
  if (desktop !== null) return <DesktopDownloadButton desktop={desktop} target={target} />
  if (!opensInRavenPlayer) return null
  return (
    <Button
      icon="download"
      data-wide
      onClick={() => ravenPlayer.open(downloadLinkFor({ origin: window.location.origin, target }))}
    >
      Download to Raven
    </Button>
  )
}
