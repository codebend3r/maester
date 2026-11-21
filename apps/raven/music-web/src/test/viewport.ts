import { act } from '@testing-library/react'
import { sizeWindow } from '@tooling/web/viewport'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

/** A window as wide as each layout's reference frame: the handoff's phone, and its tablet. */
const WIDTHS = {
  [FORM_FACTORS.phone]: 390,
  [FORM_FACTORS.tablet]: 1194,
} as const satisfies Record<FormFactor, number>

const HEIGHT = 844

/**
 * Makes the window as wide as a layout's, so `useFormFactor` and the media queries answer as that
 * layout's would; a component already on screen redraws for it. happy-dom lays nothing out, so a
 * test of a layout checks what renders, and the look itself is checked in a browser. The setup
 * puts the window back after each test.
 */
export const atFormFactor = (formFactor: FormFactor): void => {
  act(() => sizeWindow({ width: WIDTHS[formFactor], height: HEIGHT }))
}

/** Puts the window back at the wide layout's width, where every test starts. */
export const resetViewport = (): void =>
  sizeWindow({ width: WIDTHS[FORM_FACTORS.tablet], height: HEIGHT })

resetViewport()
