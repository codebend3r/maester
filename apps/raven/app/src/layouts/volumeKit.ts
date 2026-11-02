import type { IconName } from '@raven/ui/iconDrawings'
import type { AccessibilityActionInfo } from 'react-native'

/** How far a screen reader's swipe moves the volume, as a share of full. */
const VOLUME_STEP = 0.1

type VolumeIconOfProps = { volume: number; isMuted: boolean }

/** The speaker the web draws for a volume: crossed out when silent, one wave when low. */
export const volumeIconOf = ({ volume, isMuted }: VolumeIconOfProps): IconName => {
  if (isMuted || volume === 0) return 'muted'
  return volume < 0.5 ? 'volumeLow' : 'volume'
}

type VolumeAtProps = { x: number; width: number }

/** The volume a finger at `x` along a slider `width` wide asks for, from 0 to 1. */
export const volumeAt = ({ x, width }: VolumeAtProps): number =>
  width <= 0 ? 0 : Math.min(1, Math.max(0, x / width))

type SteppedVolumeProps = { volume: number; direction: -1 | 1 }

/** The volume a screen reader's swipe up or down moves to, in whole hundredths. */
export const steppedVolume = ({ volume, direction }: SteppedVolumeProps): number =>
  Math.round(Math.min(1, Math.max(0, volume + direction * VOLUME_STEP)) * 100) / 100

/** The actions a screen reader offers on the slider, and the way each moves the volume. */
const VOLUME_ACTIONS = { increment: 'increment', decrement: 'decrement' } as const

type VolumeAction = keyof typeof VOLUME_ACTIONS

const VOLUME_DIRECTIONS = { increment: 1, decrement: -1 } as const satisfies Record<
  VolumeAction,
  -1 | 1
>

export const VOLUME_ACTION_LIST: AccessibilityActionInfo[] = Object.values(VOLUME_ACTIONS).map(
  (name) => ({ name }),
)

const isVolumeAction = (name: string): name is VolumeAction => Object.hasOwn(VOLUME_ACTIONS, name)

type VolumeAfterActionProps = { volume: number; name: string }

/** The volume a screen reader's action moves to; `volume` itself for an action the slider does not offer. */
export const volumeAfterAction = ({ volume, name }: VolumeAfterActionProps): number =>
  isVolumeAction(name) ? steppedVolume({ volume, direction: VOLUME_DIRECTIONS[name] }) : volume
