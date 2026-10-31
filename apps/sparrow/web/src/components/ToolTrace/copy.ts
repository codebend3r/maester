type ChipProps = { name: string; argument: string; isOk: boolean }

export const TOOL_TRACE_COPY = {
  label: 'Tool calls',
  chip: ({ name, argument, isOk }: ChipProps) => `${isOk ? '✓' : '✕'} ${name}(${argument})`,
  input: 'Asked',
  result: 'Answered',
} as const
