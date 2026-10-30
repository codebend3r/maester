import { plural } from '@raven/core'

type UnwatchedProps = { n: number; unit: string }

export const WATCHED_COUNT_COPY = {
  unwatched: ({ n, unit }: UnwatchedProps) =>
    plural({ n, one: `unwatched ${unit}`, many: `unwatched ${unit}s` }),
} as const
