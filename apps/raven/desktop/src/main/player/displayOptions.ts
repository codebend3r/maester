import { MPV_CHOICES, MPV_PROPERTIES, type MpvOption } from '@raven/mpv'

type DisplayOptionsProps = {
  refreshRate: number
  edrHeadroom: number
}

export const displayOptions = ({ refreshRate, edrHeadroom }: DisplayOptionsProps): MpvOption[] => [
  ...(Number.isFinite(refreshRate) && refreshRate > 0
    ? [{ name: MPV_PROPERTIES.displayFpsOverride, value: refreshRate }]
    : []),
  {
    name: MPV_PROPERTIES.targetColorspaceHint,
    value: edrHeadroom > 1 ? MPV_CHOICES.yes : MPV_CHOICES.no,
  },
]

/** What a display reads as: its refresh rate and its EDR headroom. */
type DisplayReading = { refreshRate: number; edrHeadroom: number }

type DisplayReadingProps = {
  frequency: number
  display: () => DisplayReading
}

/**
 * The display the window is on: Electron's frequency for it, else what the surface reads
 * from its screen (the patched context reports none), with the surface's EDR headroom.
 * Null once mpv is destroyed, since the surface is gone with it.
 */
export const displayReading = ({
  frequency,
  display,
}: DisplayReadingProps): DisplayReading | null => {
  try {
    const { refreshRate, edrHeadroom } = display()
    const isKnown = Number.isFinite(frequency) && frequency > 0
    return { refreshRate: isKnown ? frequency : refreshRate, edrHeadroom }
  } catch {
    return null
  }
}
