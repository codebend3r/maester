const COUNT = new Intl.NumberFormat('en-US')

type LeftProps = { left: number; total: number }

export const USAGE_METER_COPY = {
  label: 'Model and token budget',
  left: ({ left, total }: LeftProps) => ({
    left: COUNT.format(left),
    rest: ` / ${COUNT.format(total)} tokens left`,
  }),
} as const
