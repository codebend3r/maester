/** The events the render tests fire, named as `fireEvent` takes them: the handler without `on`. */
export const NATIVE_EVENTS = {
  focus: 'focus',
  blur: 'blur',
  error: 'error',
  endEditing: 'endEditing',
  submitEditing: 'submitEditing',
} as const
