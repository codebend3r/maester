const count = new Intl.NumberFormat()

type ProgressProps = { done: number; total: number }

type WaitingProps = ProgressProps & { why: string }

export const RATINGS_STATUS_COPY = {
  updating: ({ done, total }: ProgressProps) =>
    `Updating ratings · ${count.format(done)} of ${count.format(total)}`,
  waiting: ({ done, total, why }: WaitingProps) =>
    `Ratings: ${count.format(done)} of ${count.format(total)} · ${why}`,
  budget: 'the rest after midnight UTC (daily limit)',
  unavailable: 'waiting for the ratings service',
} as const
