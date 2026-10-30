export const CONFIRM_DELETE_COPY = {
  title: (label: string) => `Delete ${label}?`,
  hint: 'This removes the file from disk. It cannot be undone.',
} as const
