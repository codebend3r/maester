import { type DownloadTarget, downloadLinkFor } from '@raven/core'
import { Button, usePlayerPrefs } from '@raven/ui'
import { ravenPlayer } from '@/lib/ravenPlayer'

/**
 * Hands a title to raven player to keep on its disk. Shown only where this
 * browser says raven player is installed, as Settings' toggle does.
 */
export const DownloadButton = ({ target }: { target: DownloadTarget }) => {
  const opensInRavenPlayer = usePlayerPrefs((prefs) => prefs.opensInRavenPlayer)
  if (!opensInRavenPlayer) return null
  return (
    <Button
      icon="download"
      onClick={() => ravenPlayer.open(downloadLinkFor({ origin: window.location.origin, target }))}
    >
      Download to raven player
    </Button>
  )
}
