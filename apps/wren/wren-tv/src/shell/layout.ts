import { Dimensions } from 'react-native'

import { SIZE, SPACE } from '@/theme/tvTokens'
import { columnsFitting } from '@/ui/grid'

/**
 * The width a page the stack pushed has: the TV's window less the title-safe gutter on either
 * side. A TV's window keeps its size, so it is read once.
 */
export const PAGE_WIDTH = Dimensions.get('window').width - SPACE.gutter * 2

/** The width a tab's content has, beside the folded sidebar. */
const CONTENT_WIDTH = PAGE_WIDTH - SIZE.sidebarClosed

/** How many tiles a tab's `TileGrid` fits to a row, beside the folded sidebar. */
export const TAB_TILE_COLUMNS = columnsFitting({
  width: CONTENT_WIDTH,
  tile: SIZE.tile,
  gap: SPACE.s4,
})
