/** How adding a show to an account's binge list went: done, no such show, only a locked library holds it, or the list is full. */
export const BINGE_OUTCOMES = {
  done: 'done',
  missing: 'missing',
  locked: 'locked',
  full: 'full',
} as const

export type BingeOutcome = (typeof BINGE_OUTCOMES)[keyof typeof BINGE_OUTCOMES]
