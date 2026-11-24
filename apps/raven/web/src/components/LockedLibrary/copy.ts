export const LOCKED_LIBRARY_COPY = {
  locked: 'Locked',
  isLocked: (name: string) => `${name} is locked.`,
  unlock: 'Unlock',
  unlockAtHome:
    "A PIN unlock holds only on a server's own page. Open this server's address to unlock it there.",
} as const
