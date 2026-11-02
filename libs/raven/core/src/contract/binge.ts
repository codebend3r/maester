import { type Infer, isBoolean, isNumber, listOf, object } from '@/schema'

/** How many shows an account can binge at once. */
export const BINGE_LIMIT = 3

/** `GET /api/binge`: the show ids an account is binging, most recently added first, and whether it has seen the tip. */
export const isBingeState = object({
  ids: listOf(isNumber),
  hasSeenTip: isBoolean,
})

export type BingeState = Infer<typeof isBingeState>

/** `PUT /api/binge/:id`. */
export const isBingeChange = object({
  binge: isBoolean,
})

export type BingeChange = Infer<typeof isBingeChange>
