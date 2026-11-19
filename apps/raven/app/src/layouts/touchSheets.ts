import { THEME_TONES } from '@raven/core'
import type { ComponentRef, RefObject } from 'react'
import { ActionSheetIOS, Alert, type View, findNodeHandle } from 'react-native'

import { CANCEL } from '@/layouts/gridKit'
import { DEVICE_TRAITS } from '@/platform/devicePlatform'
import { ECOSYSTEMS, type Ecosystem } from '@/platform/platform'
import {
  type ChoiceSheet,
  DRAWN_SHEETS,
  type PromptSheet,
  useDrawnSheet,
} from '@/stores/drawnSheet'
import { themeNow } from '@/theme/useTheme'

/** The view a sheet points at as a popover on an iPad. */
export type SheetAnchor = RefObject<ComponentRef<typeof View> | null>

type ShowChoiceProps = ChoiceSheet & { anchor: SheetAnchor | null }

/** How a platform shows a choice sheet and a name's prompt. */
type SheetKit = {
  showChoice: (props: ShowChoiceProps) => void
  askText: (props: PromptSheet) => void
}

/**
 * Apple's own: the system's action sheet, on an iPad as a popover pointing at the anchor, and its
 * prompt, light or dark as the theme's ground is, and the sheet dark over the video.
 */
const appleSheets: SheetKit = {
  showChoice: ({ title, message, options, isOverPicture, anchor }) => {
    const view = anchor?.current ?? null
    const node = view === null ? null : findNodeHandle(view)
    const destructiveIndex = options.findIndex((option) => option.isDestructive)
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        ...(message === null ? {} : { message }),
        options: [...options.map((option) => option.label), CANCEL],
        cancelButtonIndex: options.length,
        ...(destructiveIndex === -1 ? {} : { destructiveButtonIndex: destructiveIndex }),
        ...(node === null ? {} : { anchor: node }),
        userInterfaceStyle: isOverPicture ? THEME_TONES.dark : themeNow().tone,
      },
      (index) => {
        const chosen = options[index]
        if (chosen !== undefined) chosen.onPress()
      },
    )
  },
  askText: ({ title, initial, submit, onSubmit }) => {
    Alert.prompt(
      title,
      undefined,
      [
        { text: CANCEL, style: 'cancel' },
        { text: submit, onPress: (value) => onSubmit(value ?? '') },
      ],
      'plain-text',
      initial,
      undefined,
      { userInterfaceStyle: themeNow().tone },
    )
  },
}

/** raven's own, drawn by `DrawnSheetHost`, where the system has neither (Android). */
const drawnSheets: SheetKit = {
  showChoice: ({ title, message, options, isOverPicture }) =>
    useDrawnSheet
      .getState()
      .show({ kind: DRAWN_SHEETS.choice, title, message, options, isOverPicture }),
  askText: (prompt) => useDrawnSheet.getState().show({ kind: DRAWN_SHEETS.prompt, ...prompt }),
}

const SHEET_KITS = {
  [ECOSYSTEMS.apple]: appleSheets,
  [ECOSYSTEMS.android]: drawnSheets,
} as const satisfies Record<Ecosystem, SheetKit>

/** This device's choice sheet and prompt, used by every touch picker, menu and name. */
export const { showChoice, askText } = SHEET_KITS[DEVICE_TRAITS.ecosystem]
