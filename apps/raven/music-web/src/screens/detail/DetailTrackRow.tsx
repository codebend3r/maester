import type { ComponentProps } from 'react'
import { TrackRow } from '@/components/TrackRow/TrackRow'
import { FORM_FACTORS, type FormFactor, useFormFactor } from '@/theme/formFactor'

// The wide layout's tracklist marks the playing row with a soft fill as well as the equalizer.
const IS_ROW_HIGHLIGHTED = {
  [FORM_FACTORS.phone]: false,
  [FORM_FACTORS.tablet]: true,
} as const satisfies Record<FormFactor, boolean>

type DetailTrackRowProps = Omit<ComponentProps<typeof TrackRow>, 'isHighlighted'>

/** A track of an album's or a playlist's tracklist, set in and filled while it plays on the wide layout. */
export function DetailTrackRow(props: DetailTrackRowProps) {
  const isHighlighted = IS_ROW_HIGHLIGHTED[useFormFactor()]
  return (
    <li>
      <TrackRow {...props} isHighlighted={isHighlighted} />
    </li>
  )
}
