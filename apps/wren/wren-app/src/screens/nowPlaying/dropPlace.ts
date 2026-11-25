type DropPlaceOfProps = {
  place: number
  /** How far the row was dragged, in points, down positive. */
  shift: number
  rowHeight: number
  /** The first and last places a row may land on: the songs after the one playing. */
  first: number
  last: number
}

/** Where a dragged row lands: as many places as whole rows it moved past, inside the list. */
export const dropPlaceOf = ({ place, shift, rowHeight, first, last }: DropPlaceOfProps): number =>
  Math.min(last, Math.max(first, place + Math.round(shift / rowHeight)))
