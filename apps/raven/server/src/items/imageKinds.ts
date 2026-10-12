import { isItemImageOptions, keyOf } from '@raven/core'

/** The pictures Edit images chooses between, and offers TMDB's of: a poster, a backdrop and a movie's logo. */
export const isChoosableImageKind = keyOf(isItemImageOptions.shape)
