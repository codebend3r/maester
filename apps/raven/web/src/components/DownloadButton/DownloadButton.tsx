import { type DownloadTarget, downloadLinkFor } from '@raven/core'
import { Button } from '@raven/ui'
import { usePlayerPrefs } from '@raven/ui/headless'
import { ravenPlayer } from '@/lib/ravenPlayer'

/**
 * Hands a title to raven player to keep on its disk. Shown only where this
 * browser says raven player is installed, as Settings' toggle does. Its label
 * cannot wrap or shrink, so it marks itself wide and the header's action row
 * makes room for it (see ItemHeader).
 */
export const DownloadButton = ({ target }: { target: DownloadTarget }) => {
  const opensInRavenPlayer = usePlayerPrefs((prefs) => prefs.opensInRavenPlayer)
  if (!opensInRavenPlayer) return null
  return (
    <Button
      icon="download"
      data-wide
      onClick={() => ravenPlayer.open(downloadLinkFor({ origin: window.location.origin, target }))}
    >
      Download to raven player
    </Button>
  )
}
