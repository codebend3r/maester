import { act } from '@testing-library/react'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

/** What happy-dom's window adds for a test to size the window. */
type HappyDomViewport = { setViewport: (size: { width: number; height: number }) => void }

const isHappyDomViewport = (value: unknown): value is HappyDomViewport =>
  typeof value === 'object' &&
  value !== null &&
  'setViewport' in value &&
  typeof value.setViewport === 'function'

/** A window as wide as each layout's reference frame: the handoff's phone, and its tablet. */
const WIDTHS = {
  [FORM_FACTORS.phone]: 390,
  [FORM_FACTORS.tablet]: 1194,
} as const satisfies Record<FormFactor, number>

const HEIGHT = 844

const sizeWindow = (width: number): void => {
  const happyDom: unknown = Reflect.get(window, 'happyDOM')
  if (!isHappyDomViewport(happyDom)) throw new Error('happy-dom cannot size this window')
  happyDom.setViewport({ width, height: HEIGHT })
}

/**
 * Makes the window as wide as a layout's, so `useFormFactor` and the media queries answer as that
 * layout's would; a component already on screen redraws for it. happy-dom lays nothing out, so a
 * test of a layout checks what renders, and the look itself is checked in a browser. The setup
 * puts the window back after each test.
 */
export const atFormFactor = (formFactor: FormFactor): void => {
  act(() => sizeWindow(WIDTHS[formFactor]))
}

/** Puts the window back at the wide layout's width, where every test starts. */
export const resetViewport = (): void => sizeWindow(WIDTHS[FORM_FACTORS.tablet])

resetViewport()
