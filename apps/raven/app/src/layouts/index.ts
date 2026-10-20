import { Platform } from 'react-native'

import { focusForm } from '@/layouts/Form.focus'
import { focusGrid } from '@/layouts/Grid.focus'
import { focusItem } from '@/layouts/ItemLayout.focus'
import { touchItem } from '@/layouts/ItemLayout.touch'
import { touchGrid } from '@/layouts/Grid.touch'
import { focusPicker } from '@/layouts/Picker.focus'
import { touchPicker } from '@/layouts/Picker.touch'
import { focusShelf } from '@/layouts/Shelf.focus'
import { touchShelf } from '@/layouts/Shelf.touch'
import { touchForm } from '@/layouts/Form.touch'

export { BUTTON_TONES } from '@/layouts/formKit'

/** The form a screen asks for: driven by focus on a TV, by touch everywhere else. */
export const { Form, Field, FormButton } = Platform.isTV ? focusForm : touchForm

/** Home's shelves: rows the remote moves along on a TV, rows under the thumb everywhere else. */
export const { Shelves, Shelf } = Platform.isTV ? focusShelf : touchShelf

/** A library's grid: rows the remote moves through on a TV, columns under the thumb elsewhere. */
export const { Grid } = Platform.isTV ? focusGrid : touchGrid

/**
 * The toolbar's pickers: a list the remote moves through on a TV, where tvOS has no action
 * sheet, and the system's action sheet on the only touch screens the app runs on, iPhones
 * and iPads.
 */
export const { Picker, ToolButton } = Platform.isTV ? focusPicker : touchPicker

/**
 * An item's page: a heading over the backdrop the remote opens on, with rows to move along,
 * on a TV; one page scrolled under the thumb everywhere else.
 */
export const { ItemLayout, ItemNotice } = Platform.isTV ? focusItem : touchItem
