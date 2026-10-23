import { Platform } from 'react-native'

import { focusForm } from '@/layouts/Form.focus'
import { focusShelf } from '@/layouts/Shelf.focus'
import { touchShelf } from '@/layouts/Shelf.touch'
import { touchForm } from '@/layouts/Form.touch'

export { BUTTON_TONES } from '@/layouts/formKit'

/** The form a screen asks for: driven by focus on a TV, by touch everywhere else. */
export const { Form, Field, FormButton } = Platform.isTV ? focusForm : touchForm

/** Home's shelves: rows the remote moves along on a TV, rows under the thumb everywhere else. */
export const { Shelves, Shelf } = Platform.isTV ? focusShelf : touchShelf
