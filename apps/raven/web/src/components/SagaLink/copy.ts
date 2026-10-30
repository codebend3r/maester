type PartProps = { part: number; total: number }

export const SAGA_LINK_COPY = {
  part: ({ part, total }: PartProps) => `Part ${part} of ${total} in the saga`,
  viewSaga: 'View saga',
} as const
