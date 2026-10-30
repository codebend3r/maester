export const TOOL_TRACE_COPY = {
  calls: (count: number) => `${count} tool ${count === 1 ? 'call' : 'calls'}:`,
  ok: 'ok',
  error: 'error',
} as const
