import { FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'

/** A tablet's tracklist marks the playing row with a soft fill as well as the equalizer. */
export const IS_ROW_HIGHLIGHTED = {
  [FORM_FACTORS.phone]: false,
  [FORM_FACTORS.tablet]: true,
} as const satisfies Record<FormFactor, boolean>
