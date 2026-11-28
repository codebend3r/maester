import { type ComponentRef, useEffect, useRef } from 'react'
import type { View } from 'react-native'

import { isOptionBlocked } from '@/cardMenu/menuOptions'
import {
  type CardMenuKit,
  type CardMenuViewProps,
  type ReadingMenuProps,
} from '@/layouts/cardMenuKit'
import { openPickerSheet } from '@/layouts/Picker.touch'
import { CAN_DOWNLOAD } from '@/layouts/downloadKind'

type MessageOfProps = Pick<CardMenuViewProps, 'about' | 'options'>

/**
 * What the sheet says under the title: what is known of an album or the track playing, then why
 * each option it cannot offer is not there; null with neither.
 */
const messageOf = ({ about, options }: MessageOfProps): string | null => {
  const reasons = options.flatMap(({ blockedBy }) => (blockedBy === null ? [] : [blockedBy]))
  const lines = [...(about === null ? [] : [about]), ...reasons]
  return lines.length === 0 ? null : lines.join('\n')
}

/**
 * The menu a long press opens under the thumb: the system's action sheet over the card's title,
 * one line per option, opened once the title is read and then closed at once, since the sheet
 * is the system's and lives on without the card. An option that is blocked now is not on the
 * sheet, which cannot draw one faint; its why is the sheet's message instead.
 */
const CardMenuView = ({ title, about, options, onClose }: CardMenuViewProps) => {
  const hasOpened = useRef(false)
  // The sheet is a popover on an iPad: with no view to point at it sits centred.
  const anchor = useRef<ComponentRef<typeof View>>(null)
  useEffect(() => {
    if (hasOpened.current) return
    hasOpened.current = true
    const offered = options.filter((option) => !isOptionBlocked(option))
    openPickerSheet({
      label: title,
      message: messageOf({ about, options }),
      options: offered,
      onChoose: (key) => offered.find((option) => option.key === key)?.onPress(),
      destructiveKey: offered.find((option) => !!option.isDestructive)?.key ?? null,
      anchor,
    })
    onClose()
  }, [title, about, options, onClose])
  return null
}

/** Nothing shows while the title is read; a read that fails opens no sheet and lets the hold go. */
const ReadingMenu = ({ isFailed, onClose }: ReadingMenuProps) => {
  useEffect(() => {
    if (isFailed) onClose()
  }, [isFailed, onClose])
  return null
}

/** A card's menu on a phone or tablet: the system's action sheet, with Download, as the touch downloads kit has it. */
export const touchCardMenu: CardMenuKit = {
  CardMenuView,
  ReadingMenu,
  canDownload: CAN_DOWNLOAD.touch,
}
