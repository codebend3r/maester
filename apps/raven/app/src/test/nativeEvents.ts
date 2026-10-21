/** The events the render tests fire, named as `fireEvent` takes them: the handler without `on`. */
export const NATIVE_EVENTS = {
  focus: 'focus',
  blur: 'blur',
  layout: 'layout',
  error: 'error',
  endEditing: 'endEditing',
  submitEditing: 'submitEditing',
  valueChange: 'valueChange',
  requestClose: 'requestClose',
} as const
