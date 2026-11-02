import { ITEM_TYPES, SESSION_KINDS, type ViewingSession } from '@raven/core'

type ViewingOfProps = {
  /** The session the route names, when the viewer chose one (a saga's). */
  chosen: ViewingSession | null
  itemType: (typeof ITEM_TYPES)[keyof typeof ITEM_TYPES] | null
}

/**
 * What the viewer is watching, which says what plays next: the session they chose, else an
 * episode's show, else the video alone.
 */
export const viewingOf = ({ chosen, itemType }: ViewingOfProps): ViewingSession => {
  if (chosen !== null) return chosen
  if (itemType === ITEM_TYPES.episode) return { kind: SESSION_KINDS.show }
  return { kind: SESSION_KINDS.single }
}
