export const PIN_PAD_COPY = {
  title: 'Unlock libraries',
  hint: 'Enter the PIN to open the locked libraries in this browser.',
  pad: 'PIN pad',
  empty: 'Enter the PIN',
  dot: '●',
  entered: (count: number) => (count === 1 ? '1 digit entered' : `${count} digits entered`),
  backspace: 'Delete the last digit',
  unlock: 'Unlock',
} as const
