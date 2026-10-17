import type { MpvOption } from '@/main/player/outputOptions'

export const displayOptions = ({
  refreshRate,
  edrHeadroom,
}: {
  refreshRate: number
  edrHeadroom: number
}): MpvOption[] => [
  ...(Number.isFinite(refreshRate) && refreshRate > 0
    ? [{ name: 'display-fps-override', value: refreshRate }]
    : []),
  { name: 'target-colorspace-hint', value: edrHeadroom > 1 ? 'yes' : 'no' },
]

/**
 * The display the window is on: Electron's frequency for it, else what the surface reads
 * from its screen (the patched context reports none), with the surface's EDR headroom.
 * Null once mpv is destroyed, since the surface is gone with it.
 */
export const displayReading = ({
  frequency,
  display,
}: {
  frequency: number
  display: () => { refreshRate: number; edrHeadroom: number }
}): { refreshRate: number; edrHeadroom: number } | null => {
  try {
    const { refreshRate, edrHeadroom } = display()
    const isKnown = Number.isFinite(frequency) && frequency > 0
    return { refreshRate: isKnown ? frequency : refreshRate, edrHeadroom }
  } catch {
    return null
  }
}
