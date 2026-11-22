import { type FormFactor, useLayoutUnder } from '@/theme/formFactor'

/*
 * Now Playing's two rows need a window wider than `64rem`: under it the player's column, 30% of
 * the width, is too narrow for the transport, as an upright tablet's is in the apps. The
 * stylesheets' `64rem` too.
 */
const PANES_QUERY = '(max-width: 64rem)'

/**
 * The layout for Now Playing: the tablet's two rows in a window wider than `64rem`, the phone's
 * panes otherwise, as the apps keep the panes on a tablet held upright.
 */
export const usePlayerFormFactor = (): FormFactor => useLayoutUnder({ query: PANES_QUERY })
