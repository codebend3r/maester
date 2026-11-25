import { classNames } from '@raven/ui/headless'
import { SIZES } from '@/theme/tokens'
import type { WrenIconName } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/IconTile/IconTile.module.scss'

/** How an icon tile is drawn: quiet, as most rows' are, or in red, as the server's is. */
export const TILE_TONES = { quiet: 'quiet', accent: 'accent' } as const

type TileTone = (typeof TILE_TONES)[keyof typeof TILE_TONES]

type IconTileProps = { icon: WrenIconName; tone?: TileTone }

/** A Settings row's lead: its icon on a small rounded tile. */
export function IconTile({ icon, tone = TILE_TONES.quiet }: IconTileProps) {
  return (
    <span className={classNames([styles.tile, styles[tone]])}>
      <WrenIcon name={icon} size={SIZES.smallIcon} />
    </span>
  )
}
