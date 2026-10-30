export const LOCKED_LIBRARY_COPY = {
  locked: 'Locked',
  isLocked: (name: string) => `${name} is locked.`,
  unlock: 'Unlock',
  setPinBefore: 'Set ',
  setPinBetween: " in raven's ",
  setPinAfter: ' to open it.',
  pinVariable: 'LIBRARY_PIN',
} as const
