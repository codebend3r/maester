import { View } from 'react-native'

import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { type Palette, RADIUS, SIZE } from '@/theme/wrenTokens'
import { WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

/** How an icon tile is drawn: quiet, as most rows' are, or in red, as the server's is. */
export const TILE_TONES = { quiet: 'quiet', accent: 'accent' } as const

type TileTone = (typeof TILE_TONES)[keyof typeof TILE_TONES]

/** The colour each tone draws its icon in. */
const TILE_INKS = {
  [TILE_TONES.quiet]: 'text2',
  [TILE_TONES.accent]: 'accentText',
} as const satisfies Record<TileTone, keyof Palette>

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  tile: {
    alignItems: 'center',
    borderRadius: RADIUS.sm,
    height: SIZE.iconTile,
    justifyContent: 'center',
    width: SIZE.iconTile,
  },
  [TILE_TONES.quiet]: { backgroundColor: colors.surface2 },
  [TILE_TONES.accent]: { backgroundColor: colors.accentSoft },
}))

type IconTileProps = { icon: WrenIconName; tone?: TileTone }

/** A Settings row's lead: its icon on a small rounded tile. */
export function IconTile({ icon, tone = TILE_TONES.quiet }: IconTileProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <View style={[styles.tile, styles[tone]]}>
      <WrenIcon color={colors[TILE_INKS[tone]]} name={icon} size={SIZE.smallIcon} />
    </View>
  )
}
