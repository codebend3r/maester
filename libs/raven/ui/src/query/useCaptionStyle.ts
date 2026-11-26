import type { CaptionStyle } from '@raven/core'
import { usePlayerPrefs } from '@/stores/playerPrefs'

type CaptionStyleHandle = {
  style: CaptionStyle
  change: (change: Partial<CaptionStyle>) => void
}

/**
 * How subtitles look on this device, the same for every video it plays. Each device keeps its own
 * in the player prefs, so a TV, a desktop and a phone on one account can each draw them their way.
 * `change` merges the size, the colour or both into the kept look.
 */
export const useCaptionStyle = (): CaptionStyleHandle => {
  const style = usePlayerPrefs((prefs) => prefs.captionStyle)
  const keep = usePlayerPrefs((prefs) => prefs.setCaptionStyle)
  return { style, change: (change) => keep({ ...style, ...change }) }
}
