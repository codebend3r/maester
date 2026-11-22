import { type FormFactor, useLayoutUnder } from '@/theme/formFactor'
import { MEDIA_QUERIES } from '@/theme/media'

/**
 * The layout for Now Playing: the tablet's two rows in a window wider than `64rem`, the phone's
 * panes otherwise, as the apps keep the panes on a tablet held upright.
 */
export const usePlayerFormFactor = (): FormFactor => useLayoutUnder({ query: MEDIA_QUERIES.rail })
