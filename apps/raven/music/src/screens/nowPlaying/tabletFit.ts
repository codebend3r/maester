import { PLAYER_SIZES, SIZE, SPACE } from '@/theme/wrenTokens'

/** The first row's share of the screen's height; Up next takes the rest. */
const TOP_ROW_SHARE = 0.6

/** The player column's share of the first row's width; the lyrics take the rest. */
const PLAYER_COLUMN_SHARE = 0.3

/** The player column's gap, between the header, the cover and each control, and its own padding. */
export const TABLET_COLUMN_GAP = SPACE.s4

/*
 * The height the player column keeps for what is not the cover: the header, the scrubber, the
 * transport and the volume, the four gaps between the five and the column's own padding.
 */
const CONTROLS_ROOM =
  SIZE.touchTarget + PLAYER_SIZES.playQueue + 2 * SIZE.scrubThumb + 6 * TABLET_COLUMN_GAP

type TabletFitOfProps = {
  /** The window, less the insets the screen keeps clear. */
  width: number
  height: number
}

/** The first row's height, the player column's width and the cover's side, in points. */
type TabletFit = { topHeight: number; playerWidth: number; art: number }

/**
 * How the tablet's Now Playing divides a window: the first row's height, the player column's
 * width in it, and the cover's side, which is what the column's width and the row's height leave
 * beside the controls, so they stay on screen on a short tablet, and never under a small cover's.
 */
export const tabletFitOf = ({ width, height }: TabletFitOfProps): TabletFit => {
  const topHeight = height * TOP_ROW_SHARE
  const playerWidth = width * PLAYER_COLUMN_SHARE
  const room = Math.min(playerWidth - 2 * PLAYER_SIZES.gutter, topHeight - CONTROLS_ROOM)
  return {
    topHeight,
    playerWidth,
    art: Math.max(PLAYER_SIZES.compactArt, Math.min(PLAYER_SIZES.tabletArt, room)),
  }
}
