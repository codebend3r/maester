import { parseTokens } from '@/lib/tokens'
import globals from '@/styles/globals.scss?raw'

/** The tokens globals.scss declares, read from the file itself so /design never falls behind it. */
export const designTokens = parseTokens(globals)
