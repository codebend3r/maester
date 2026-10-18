/** How marking or unmarking a favourite went: done, nothing by that id, or refused for a locked library's. */
export const FAVOURITE_OUTCOMES = { done: 'done', missing: 'missing', locked: 'locked' } as const

export type FavouriteOutcome = (typeof FAVOURITE_OUTCOMES)[keyof typeof FAVOURITE_OUTCOMES]
