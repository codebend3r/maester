import { Platform } from 'react-native'

import { focusDownloads } from '@/layouts/Downloads.focus'
import { touchDownloads } from '@/layouts/Downloads.touch'
import { focusForm } from '@/layouts/Form.focus'
import { focusGrid } from '@/layouts/Grid.focus'
import { focusItem } from '@/layouts/ItemLayout.focus'
import { touchItem } from '@/layouts/ItemLayout.touch'
import { touchGrid } from '@/layouts/Grid.touch'
import { focusPicker } from '@/layouts/Picker.focus'
import { dpadPlayerChrome, tvosPlayerChrome } from '@/layouts/PlayerChrome.dpad'
import { focusSearch } from '@/layouts/Search.focus'
import { focusSettings } from '@/layouts/Settings.focus'
import { touchSettings } from '@/layouts/Settings.touch'
import { touchSearch } from '@/layouts/Search.touch'
import { touchPicker } from '@/layouts/Picker.touch'
import { focusShelf } from '@/layouts/Shelf.focus'
import { touchShelf } from '@/layouts/Shelf.touch'
import { focusHero } from '@/layouts/HomeHero.focus'
import { touchHero } from '@/layouts/HomeHero.touch'
import { touchForm } from '@/layouts/Form.touch'
import { focusLoading } from '@/layouts/Loading.focus'
import { focusLock, touchLock } from '@/layouts/Lock'
import { focusMusic } from '@/layouts/Music.focus'
import { touchMusic } from '@/layouts/Music.touch'
import { touchLoading } from '@/layouts/Loading.touch'
import { touchPlayerChrome } from '@/layouts/PlayerChrome.touch'
import type { PlayerChromeKit } from '@/layouts/playerKit'
import { DEVICE_PLATFORM } from '@/platform/devicePlatform'
import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'

export { BUTTON_TONES } from '@/layouts/formKit'

/** What a page shows while it loads: the mark and a spinner, with the way back under the thumb. */
export const { Loading } = Platform.isTV ? focusLoading : touchLoading

/** The form a screen asks for: driven by focus on a TV, by touch everywhere else. */
export const { Form, Field, FormButton, useFormStyles } = Platform.isTV ? focusForm : touchForm

/**
 * The PIN lock: what stands in place of a locked library's videos, and the pad of digits the
 * owner unlocks with, keys the remote moves through on a TV and a finger presses elsewhere.
 */
export const { LockedNotice, PinPad } = Platform.isTV ? focusLock : touchLock

/**
 * Downloads, under the thumb only: the page of what is on the device and on its way, and
 * whether the item pages offer Download. A TV downloads nothing.
 */
export const { DownloadsLayout, canDownload } = Platform.isTV ? focusDownloads : touchDownloads

/** Home's shelves: rows the remote moves along on a TV, rows under the thumb everywhere else. */
export const { Shelves, Shelf, BingeShelf, ShelfPage } = Platform.isTV ? focusShelf : touchShelf

/** Home's hero over its shelves: the featured titles in turn on a TV, a swiped carousel under the thumb. */
export const { HomeHero } = Platform.isTV ? focusHero : touchHero

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
  SettingsToggle,
  SettingsButton,
  SettingsLine,
  SettingsChoice,
} = Platform.isTV ? focusSettings : touchSettings

/**
 * The music pages: an album's, a playlist's and Now Playing, rows and plates the remote moves
 * through on a TV, one page scrolled under the thumb everywhere else; the strip under the screens
 * while a track plays, which the remote reaches below a screen on a TV; New playlist, which only
 * the touch screens offer, and the favourite mark a toolbar wears.
 */
export const {
  AlbumLayout,
  NowPlayingLayout,
  NowPlayingStrip,
  PlaylistLayout,
  NewPlaylistButton,
  FavouriteButton,
} = Platform.isTV ? focusMusic : touchMusic

/**
 * Each platform's player controls: raven's own on every one, under the thumb on iPhones and iPads
 * and under the remote on the two TVs (the Siri Remote and the d-pad), all with the subtitle cues
 * raven draws itself.
 */
const PLAYER_CHROMES = {
  [APP_PLATFORMS.ios]: touchPlayerChrome,
  [APP_PLATFORMS.tvos]: tvosPlayerChrome,
  [APP_PLATFORMS.androidTv]: dpadPlayerChrome,
} as const satisfies Record<AppPlatform, PlayerChromeKit>

/**
 * The player's controls, whether raven draws the subtitles under them, and whether the player
 * draws a file's picture subtitles itself, for this device.
 */
export const { PlayerChrome, shouldDrawCaptions, canDrawPictureSubtitles } =
  PLAYER_CHROMES[DEVICE_PLATFORM]
