import { Dimensions } from 'react-native'

import { SIZE, SPACE } from '@/theme/tvTokens'

/**
 * The width a page's content has: the TV's window, less the folded sidebar and the title-safe
 * gutter on either side. A TV's window keeps its size, so it is read once.
 */
export const CONTENT_WIDTH = Dimensions.get('window').width - SIZE.sidebarClosed - SPACE.gutter * 2

/** The width a page the stack pushed has, with no sidebar beside it. */
export const PAGE_WIDTH = Dimensions.get('window').width - SPACE.gutter * 2
