import { ForbiddenException, NotFoundException } from '@nestjs/common'

/** How marking or unmarking a favourite went: done, nothing by that id, or refused for a locked library's. */
export const FAVOURITE_OUTCOMES = { done: 'done', missing: 'missing', locked: 'locked' } as const

export type FavouriteOutcome = (typeof FAVOURITE_OUTCOMES)[keyof typeof FAVOURITE_OUTCOMES]

type FavouriteAnsweredProps = { outcome: FavouriteOutcome; missing: string; locked: string }

/** Throws for a favourite that could not be marked: 404 for nothing by that id, 403 for a locked library's. */
export const favouriteAnswered = ({ outcome, missing, locked }: FavouriteAnsweredProps): void => {
  switch (outcome) {
    case FAVOURITE_OUTCOMES.done:
      return
    case FAVOURITE_OUTCOMES.missing:
      throw new NotFoundException(missing)
    case FAVOURITE_OUTCOMES.locked:
      throw new ForbiddenException(locked)
    default: {
      const unknown: never = outcome
      return unknown
    }
  }
}
