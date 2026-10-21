import { Platform } from 'react-native'

import { focusForm } from '@/layouts/Form.focus'
import { focusGrid } from '@/layouts/Grid.focus'
import { focusItem } from '@/layouts/ItemLayout.focus'
import { touchItem } from '@/layouts/ItemLayout.touch'
import { touchGrid } from '@/layouts/Grid.touch'
import { focusPicker } from '@/layouts/Picker.focus'
import { dpadPlayerChrome } from '@/layouts/PlayerChrome.dpad'
import { focusPlayerChrome } from '@/layouts/PlayerChrome.focus'
import { focusSearch } from '@/layouts/Search.focus'
import { focusSettings } from '@/layouts/Settings.focus'
import { touchSettings } from '@/layouts/Settings.touch'
import { touchSearch } from '@/layouts/Search.touch'
import { touchPicker } from '@/layouts/Picker.touch'
import { focusShelf } from '@/layouts/Shelf.focus'
import { touchShelf } from '@/layouts/Shelf.touch'
import { touchForm } from '@/layouts/Form.touch'
import { touchPlayerChrome } from '@/layouts/PlayerChrome.touch'
import type { PlayerChromeKit } from '@/layouts/playerKit'
import { DEVICE_PLATFORM } from '@/platform/devicePlatform'
import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'

export { BUTTON_TONES } from '@/layouts/formKit'

/** The form a screen asks for: driven by focus on a TV, by touch everywhere else. */
export const { Form, Field, FormButton, formStyles } = Platform.isTV ? focusForm : touchForm

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

/**
 * A search box and the search screen: the platform's own keyboard, opened from a field the
 * remote selects, on a TV; a field over results under the thumb everywhere else.
 */
export const { SearchField, SearchLayout } = Platform.isTV ? focusSearch : touchSearch

/**
 * Settings: plates the remote moves down through and the TV's picker lists on a TV, a rename in
 * a sheet that Menu or Back closes; the system's switches and sheets under the thumb.
 */
export const {
  SettingsPage,
  SettingsSection,
  ServerRow,
  SettingsToggle,
  SettingsButton,
  SettingsChoice,
  SettingsSheet,
} = Platform.isTV ? focusSettings : touchSettings

/**
 * Each platform's player controls, the one layout that differs between the two TVs: Apple TV's
 * system transport, which the Siri Remote drives and whose panel lists the stream's renditions;
 * raven's own under the d-pad on Android TV and under the thumb on iPhones and iPads, both with
 * the subtitle cues raven draws itself.
 */
const PLAYER_CHROMES: Record<AppPlatform, PlayerChromeKit> = {
  [APP_PLATFORMS.ios]: touchPlayerChrome,
  [APP_PLATFORMS.tvos]: focusPlayerChrome,
  [APP_PLATFORMS.androidTv]: dpadPlayerChrome,
}

/** The player's controls, and whether raven draws the subtitles under them, for this device. */
export const { PlayerChrome, shouldDrawCaptions } = PLAYER_CHROMES[DEVICE_PLATFORM]
