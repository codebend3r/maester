/** Form controls keep their own keys: what is typed, a radio's arrows, a slider's. */
export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('input, select, textarea')
