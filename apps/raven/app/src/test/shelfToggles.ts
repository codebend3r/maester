import { SHELF_ORDER_COPY } from '@raven/core'
import { screen } from '@testing-library/react-native'

/** Whether a button is a library shelf's order toggle, by the order its label says it is in. */
const isShelfToggle = (label: unknown): boolean =>
  typeof label === 'string' &&
  Object.values(SHELF_ORDER_COPY).some((order) => label.includes(`: ${order}.`))

/** The buttons on screen but the shelves' order toggles: the cards, and the screen's own controls. */
export const cardButtons = () =>
  screen.getAllByRole('button').filter((button) => !isShelfToggle(button.props.accessibilityLabel))
